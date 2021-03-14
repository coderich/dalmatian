const { isEmpty } = require('lodash');
const Boom = require('../core/Boom');
const QueryService = require('./QueryService');
const QueryResult = require('./QueryResult');
const { mapPromise, ucFirst, mergeDeep, removeUndefinedDeep } = require('../service/app.service');

module.exports = class QueryResolver {
  constructor(query) {
    this.query = query;
    this.resolver = query.toObject().resolver;
  }

  findOne(query) {
    return this.resolver.resolve(query);
  }

  findMany(query) {
    return this.resolver.resolve(query);
  }

  count(query) {
    return this.resolver.resolve(query);
  }

  async createOne(query) {
    const { model, input } = query.toObject();
    await model.validateData({ ...input }, {}, 'create');
    return this.resolver.resolve(query).then(id => Object.assign(model.deserialize(input), { id }));
  }

  createMany(query) {
    const { model, args, transaction } = query.toObject();
    const txn = this.resolver.transaction(transaction);
    args.forEach(arg => txn.match(model).save(arg));
    return txn.run();
  }

  updateOne(query) {
    const { model, input, match } = query.toObject();

    return this.resolver.match(model).where(match).one({ required: true }).then(async (doc) => {
      await model.validateData({ ...input }, doc, 'update');
      const $doc = model.serialize(mergeDeep(doc, removeUndefinedDeep(input)));
      return this.resolver.resolve(query.doc(doc).$doc($doc)).then(() => model.deserialize($doc));
    });
  }

  updateMany(query) {
    const { model, args, match, transaction } = query.toObject();

    return this.resolver.match(model).where(match).many().then((docs) => {
      const txn = this.resolver.transaction(transaction);
      docs.forEach(doc => txn.match(model).id(doc.id).save(...args));
      return txn.run();
    });
  }

  deleteOne(query) {
    const { model, id } = query.toObject();

    return this.resolver.match(model).id(id).one({ required: true }).then((doc) => {
      return QueryService.resolveReferentialIntegrity(query).then(() => {
        return this.resolver.resolve(query).then(() => doc);
      });
    });
  }

  deleteMany(query) {
    const { model, match, transaction } = query.toObject();

    return this.resolver.match(model).where(match).many().then((docs) => {
      const txn = this.resolver.transaction(transaction);
      docs.forEach(doc => txn.match(model).id(doc.id).delete());
      return txn.run();
    });
  }

  pushOne(query) {
    const { args } = query.toObject();
    const [key, ...values] = args;
    return this.splice(query.args([key, null, values]));
  }

  pushMany(query) {
    const { args } = query.toObject();
    const { model, match, transaction } = query.toObject();
    const [key, ...values] = args;

    return this.resolver.match(model).where(match).many().then((docs) => {
      const txn = this.resolver.transaction(transaction);
      docs.forEach(doc => txn.match(model).id(doc.id).push(key, ...values));
      return txn.run();
    });
  }

  pullOne(query) {
    const { args } = query.toObject();
    const [key, ...values] = args;
    return this.splice(query.args([key, values]));
  }

  pullMany(query) {
    const { model, match, transaction, args } = query.toObject();
    const [key, ...values] = args;

    return this.resolver.match(model).where(match).many().then((docs) => {
      const txn = this.resolver.transaction(transaction);
      docs.forEach(doc => txn.match(model).id(doc.id).pull(key, ...values));
      return txn.run();
    });
  }

  splice(query) {
    const { model, match, args } = query.toObject();
    const [key, from, to] = args;

    return this.resolver.match(model).where(match).one({ required: true }).then(async (doc) => {
      const data = await QueryService.spliceEmbeddedArray(query, doc, key, from, to);
      await model.validateData({ ...data }, doc, 'update');
      const $doc = mergeDeep(doc, removeUndefinedDeep(data));
      return this.resolver.resolve(query.method('updateOne').doc(doc).$doc($doc)).then(() => model.deserialize($doc));
    });
  }

  first(query) {
    return this.findMany(query.method('findMany'));
  }

  last(query) {
    return this.findMany(query.method('findMany'));
  }

  async resolve() {
    const clone = this.query.clone();
    const { model, crud, method, match, input, sort, flags, isNative } = clone.toObject();
    clone.time('query').time('resolve').time('prepare');

    // // Select fields
    // const fields = model.getSelectFields();
    // const fieldNameToKeyMap = fields.reduce((prev, field) => Object.assign(prev, { [field.getName()]: field.getKey() }), {});
    // const $select = select ? Object.keys(select).map(n => fieldNameToKeyMap[n]) : fields.map(f => f.getKey());
    // clone.select($select);

    // Where clause
    if (!isNative) {
      let $where = removeUndefinedDeep(match);
      $where = await model.resolveBoundValues(match);
      $where = await QueryService.resolveWhereClause(clone.match($where));
      $where = model.normalize($where);
      clone.match($where);
    }

    // Input data
    if (crud === 'create' || crud === 'update') {
      const $input = await mapPromise(input, (obj) => {
        return new Promise(async (resolve) => {
          let result = removeUndefinedDeep(obj);
          if (crud === 'create') result = await model.appendDefaultValues(result);
          result = await model[`append${ucFirst(crud)}Fields`](result);
          result = model.serialize(result); // This seems to be needed to accept Objects and convert them to ids; however this also makes .save(<empty>) throw an error and I think you should be able to save empty
          resolve(result);
        });
      });

      clone.input($input);
    }

    if (sort) {
      clone.sort(Object.entries(model.serialize(sort)).reduce((prev, [key, value]) => {
        return Object.assign(prev, { [key]: value.toLowerCase() === 'asc' ? 1 : -1 });
      }, {}));
    }

    clone.timeEnd('prepare').time('execute').time('driver');

    return this[method](clone).then((data) => {
      clone.timeEnd('driver');
      if (flags.required && (data == null || isEmpty(data))) throw Boom.notFound(`${model} Not Found`);
      if (data == null) return null;
      const result = typeof data === 'object' ? new QueryResult(this.query, data) : data;
      clone.timeEnd('execute').timeEnd('resolve').timeEnd('query');
      // clone.timeReport();
      // console.log(result);
      // console.log('-------------');
      return result;
    });
  }
};
