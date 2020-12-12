const { get } = require('lodash');
const Axios = require('axios');
const Neo4j = require('neo4j-driver');
const { promiseChain, globToRegex, proxyDeep, isScalarValue } = require('../service/app.service');

class Cypher {
  constructor(config, schema) {
    this.config = config;
    this.schema = schema;
  }

  getConfig() {
    return this.config;
  }

  getDirectives() {
    return get(this.config, 'directives', {});
  }

  get(model, where, options) {
    return this.find(model, where, options).then(docs => docs[0]);
  }

  find(model, where = {}, options) {
    const { $where, $params } = Cypher.normalizeWhereClause(where);
    const $wherePart = $where ? `WHERE ${$where}` : '';
    return this.query(`MATCH (n:${model.getKey()}) ${$wherePart} RETURN n`, $params, options);
  }

  count(model, where = {}, options) {
    const { $where, $params } = Cypher.normalizeWhereClause(where);
    const $wherePart = $where ? `WHERE ${$where}` : '';
    return this.query(`MATCH (n:${model.getKey()}) ${$wherePart} RETURN count(n) AS n`, $params, options).then(counts => counts[0]);
  }

  create(model, data, options) {
    return this.query(`CREATE (n:${model.getKey()} { ${Object.keys(data).map(k => `${k}:{${k}}`)} }) SET n.id = id(n) RETURN n`, data, options).then(docs => docs[0]);
  }

  update(model, id, data, doc, options) {
    return this.query(`MATCH (n:${model.getKey()}) WHERE n.id = { id } SET ${Object.keys(doc).map(k => `n.${k}={${k}}`)} RETURN n`, { id, ...doc }, options).then(docs => docs[0]);
  }

  replace(model, id, data, doc, options) {
    return this.update(model, id, data, doc, options);
  }

  delete(model, id, doc, options) {
    return this.query(`MATCH (n:${model.getKey()}) WHERE n.id = { id } DELETE n`, { id }, options).then(() => doc);
  }

  dropModel(model) {
    return this.query(`MATCH (n:${model.getKey()}) DELETE n`);
  }

  createIndexes(model, indexes) {
    return Promise.all(indexes.map(({ type, on }) => {
      if (on.length > 1) return null;

      switch (type) {
        case 'unique': return this.query(`CREATE CONSTRAINT on (n:${model.getKey()}) ASSERT (${on.map(f => `n.${f}`).join(',')}) IS UNIQUE`);
        default: return null;
      }
    }));
  }

  static idKey() {
    return 'id';
  }

  static idValue(value) {
    return Number(value);
  }

  static normalizeWhereClause(where) {
    const $params = {};

    const obj = proxyDeep(where, {
      get(target, prop, rec) {
        const value = Reflect.get(target, prop, rec);
        if (typeof value === 'function') return value.bind(target);

        if (Array.isArray(value)) {
          $params[prop] = value;
          return `any (x IN {${prop}} WHERE x IN n.${prop})`;
        }

        if (typeof value === 'string') {
          $params[prop] = `(?i)${globToRegex(value.toLowerCase(), { unescape: true, regex: false, maxLength: 100 }).toString().slice(1, -1)}`;
          return `toString(n.${prop}) =~ {${prop}}`;
        }

        $params[prop] = value;
        return `n.${prop} = {${prop}}`;
      },
    }).toObject();

    return {
      $where: Object.values(obj).join(' AND '),
      $params,
    };
  }

  static serialize(data) {
    const serializeValue = (value) => {
      if (value instanceof Date) return value.toISOString();
      if (Array.isArray(value)) return value.map(v => serializeValue(v));
      if (typeof value === 'object') return JSON.stringify(value);
      return value;
    };

    return proxyDeep(data, {
      get(target, prop, rec) {
        const value = Reflect.get(target, prop, rec);
        if (typeof value === 'function') return value.bind(target);
        return serializeValue(value);
      },
    }).toObject();
  }

  static deserialize(data) {
    const deserializeValue = (value) => {
      if (Array.isArray(value)) return value.map(v => deserializeValue(v));
      if (typeof value === 'string') {
        try {
          const val = JSON.parse(value);
          return val;
        } catch (e) {
          return value;
        }
      }

      return value;
    };

    return proxyDeep(data, {
      get(target, prop, rec) {
        const value = Reflect.get(target, prop, rec);
        if (typeof value === 'function') return value.bind(target);
        return deserializeValue(value);
      },
    }).toObject();
  }
}

// https://neo4j.com/docs/http-api/3.5/actions/begin-a-transaction/
exports.Neo4jRestDriver = class Neo4jRestDriver extends Cypher {
  constructor(config, schema) {
    super(config, schema);

    // Grab our endpoints
    const dbData = Axios.get(`${config.uri}/db/data/`).then(({ data }) => data);
    this.session = dbData.then(data => data.cypher);
    this.txn = dbData.then(data => data.transaction);
  }

  query(query, params = {}, options = {}) {
    if (options.session) {
      return Axios.post(options.session, {
        statements: [{
          statement: query,
          parameters: Neo4jRestDriver.serialize(params),
        }],
      }).then((response) => {
        const { data = [] } = response.data.results[0];
        return Neo4jRestDriver.toObjectTxn(data);
      });
    }

    return this.session.then(url => Axios.post(url, { query, params: Neo4jRestDriver.serialize(params) }).then(({ data }) => Neo4jRestDriver.toObject(data.data || [])));
  }

  async transaction(ops) {
    const response = await this.txn.then(url => Axios.post(url, { statements: [] }));
    const session = response.headers.location;
    const commit = () => Axios.post(response.data.commit, { statements: [] });
    const rollback = () => Axios.delete(session);

    // Unfortunately must chain in series or figure out a way to combine in one shot
    return promiseChain(ops.map(op => () => op.exec({ session }))).then((results) => {
      results.$commit = () => commit();
      results.$rollback = () => rollback();
      return results;
    }).catch(async (e) => {
      await rollback();
      throw e;
    });
  }

  static toObject(records) {
    return records.map(([result]) => {
      if (isScalarValue(result)) return result;

      const { metadata, data } = result;
      return Object.defineProperty(Neo4jRestDriver.deserialize(data), 'id', { value: metadata.id });
    });
  }

  static toObjectTxn(records) {
    return records.map((result) => {
      if (isScalarValue(result)) return result;

      const { meta, row } = result;
      const [data] = row;
      const [info] = meta;
      const doc = typeof data === 'object' ? Neo4jRestDriver.deserialize(data) : data;
      return info ? Object.defineProperty(doc, 'id', { value: info.id }) : doc;
    });
  }
};

exports.Neo4jDriver = class Neo4jDriver extends Cypher {
  constructor(config, schema) {
    super(config, schema);
    this.driver = Neo4j.driver(config.uri, null, { disableLosslessIntegers: true });
  }

  query(query, params = {}, options = {}) {
    const session = options.session || this.driver.session();

    return session.run(query, Neo4jDriver.serialize(params)).then((records) => {
      if (session.close) session.close(); // could be in a transaction in which case we can't close
      return Neo4jDriver.toObject(records);
    });
  }

  transaction(ops) {
    // Create session and start transaction
    const session = this.driver.session();
    const txn = session.beginTransaction();
    const close = () => { session.close(); };

    // Execute each operation with session
    return Promise.all(ops.map(op => op.exec({ session: txn }))).then((results) => {
      results.$commit = () => txn.commit().then(close);
      results.$rollback = () => txn.rollback().then(close);
      return results;
    }).catch((e) => {
      close();
      throw e;
    });
  }

  static toObject({ records }) {
    return records.map((record) => {
      const node = record.get('n');
      if (isScalarValue(node)) return node;

      const doc = node.properties;
      return Object.defineProperty(Neo4jDriver.deserialize(doc), 'id', { value: node.identity });
    });
  }
};
