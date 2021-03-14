const { get, has } = require('lodash');
const { MongoClient, ObjectID } = require('mongodb');
const { proxyDeep, toKeyObj, globToRegex, proxyPromise, isScalarDataType, promiseRetry } = require('../service/app.service');

const projectSchema = (schema, nesting = []) => {
  return Object.entries(schema).reduce((prev, [key, { name, schema: subSchema, isArray }]) => {
    const arr = [...nesting, key];
    const $key = !isArray && subSchema ? projectSchema(subSchema, arr) : `$${arr.join('.')}`;
    return Object.assign(prev, { [name]: $key });
  }, {});
};

module.exports = class MongoDriver {
  constructor(config, schema) {
    this.config = config;
    this.schema = schema;
    this.connection = this.connect();
    this.getDirectives = () => get(config, 'directives', {});
  }

  connect() {
    return MongoClient.connect(this.config.uri, this.config.options);
  }

  raw(collection) {
    return proxyPromise(this.connection.then(client => client.db().collection(collection)));
  }

  query(collection, method, ...args) {
    if (has(args[args.length - 1], 'debug')) console.log(method, JSON.stringify(args));
    return this.raw(collection)[method](...args);
  }

  resolve(query) {
    const { isNative } = query;
    if (!isNative) query.where = MongoDriver.normalizeWhere(query.where);
    return this[query.method](query);
  }

  findOne(query) {
    return this.findMany(Object.assign(query, { first: 1 })).then(docs => docs[0]);
  }

  findMany(query) {
    const { model, options, last, flags } = query;
    return this.query(model, 'aggregate', MongoDriver.aggregateQuery(query), options, flags).then((cursor) => {
      return cursor.toArray().then((results) => {
        if (last) return results.splice(-last);
        return results;
      });
    });
  }

  count({ model, where, options, flags }) {
    return this.query(model, 'countDocuments', where, options, flags);
  }

  createOne({ model, input, options, flags }) {
    return this.query(model, 'insertOne', input, options, flags).then(result => result.insertedId);
  }

  updateOne({ model, where, $doc, options, flags }) {
    const $update = Object.entries($doc).reduce((prev, [key, value]) => {
      Object.assign(prev.$set, { [key]: value });
      return prev;
    }, { $set: {} });

    return this.query(model, 'updateOne', where, $update, options, flags);
  }

  deleteOne({ model, where, options, flags }) {
    return this.query(model, 'deleteOne', where, options, flags);
  }

  dropModel(model) {
    return this.query(model, 'deleteMany');
  }

  createCollection(model) {
    return this.connection.then(client => client.db().createCollection(model)).catch(e => null);
  }

  createIndexes(model, indexes) {
    return Promise.all(indexes.map(({ name, type, on }) => {
      const $fields = on.reduce((prev, field) => Object.assign(prev, { [field]: 1 }), {});

      switch (type) {
        case 'unique': return this.query(model, 'createIndex', $fields, { name, unique: true });
        default: return null;
      }
    }));
  }

  transaction(ops) {
    const promise = async () => {
      // Create session and start transaction
      const session = await this.connection.then(client => client.startSession({ readPreference: { mode: 'primary' } }));
      session.startTransaction({ readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } });
      const close = () => { session.endSession(); };

      // Execute each operation with session
      return Promise.all(ops.map(op => op.exec({ session }))).then((results) => {
        results.$commit = () => session.commitTransaction().then(close);
        results.$rollback = () => session.abortTransaction().then(close);
        return results;
      }).catch((e) => {
        close();
        throw e;
      });
    };

    // Retry promise conditionally
    return promiseRetry(promise, 200, 5, e => e.errorLabels && e.errorLabels.indexOf('TransientTransactionError') > -1);
  }

  static idKey() {
    return '_id';
  }

  static idValue(value) {
    if (value instanceof ObjectID) return value;

    try {
      const id = ObjectID(value);
      return id;
    } catch (e) {
      return value;
    }
  }

  static normalizeWhere(where) {
    return proxyDeep(toKeyObj(where), {
      get(target, prop, rec) {
        const value = Reflect.get(target, prop, rec);
        if (Array.isArray(value)) return { $in: value };
        if (typeof value === 'function') return value.bind(target);
        if (typeof value === 'string') { return globToRegex(value, { nocase: true, regex: true }); }
        return value;
      },
    }).toObject();
  }

  static getAddFields(query) {
    const { schema, where } = query;

    return Object.entries(schema).reduce((prev, [key, { type }]) => {
      const value = where[key];
      if (value === undefined) return prev;
      if (!isScalarDataType(type)) return false;
      const stype = String((type === 'Float' || type === 'Int' ? 'Number' : type)).toLowerCase();
      if (String(typeof value) === `${stype}`) return prev;
      return Object.assign(prev, { [key]: { $toString: `$${key}` } });
    }, {});
  }

  static aggregateQuery(query) {
    const { schema, where: $match, sort, skip, limit } = query;
    const $aggregate = [{ $match }];

    // Used for $regex matching
    const $addFields = MongoDriver.getAddFields(query);
    if (Object.keys($addFields).length) $aggregate.unshift({ $addFields });

    // Sort, Skip, Limit documents
    if (sort && Object.keys(sort).length) $aggregate.push({ $sort: Object.assign(sort, { _id: -1 }) });
    if (skip) $aggregate.push({ $skip: skip });
    if (limit) $aggregate.push({ $limit: limit });

    // Pagination
    const { after, before, first } = query;
    if (after) $aggregate.push({ $match: { $or: Object.entries(after).reduce((prev, [key, value]) => prev.concat({ [key]: { $gt: value } }), []) } });
    if (before) $aggregate.push({ $match: { $or: Object.entries(before).reduce((prev, [key, value]) => prev.concat({ [key]: { $lt: value } }), []) } });
    if (first) $aggregate.push({ $limit: first });

    // Schema
    $aggregate.push({ $project: projectSchema(schema) });
    // $aggregate.push(Object.entries(schema).reduce((prev, [key, { name, schema: subSchema }]) => {
    //   prev.$project[name] = `$${key}`;
    //   return prev;
    // }, { $project: {} }));

    return $aggregate;
  }
};
