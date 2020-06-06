const { flatten } = require('lodash');
const FBDataLoader = require('dataloader');
const TreeMap = require('../data/TreeMap');
const Model = require('../data/Model');
const QueryBuilder = require('../query/QueryBuilder');
const TxnQueryBuilder = require('../query/TransactionQueryBuilder');
const QueryWorker = require('../query/QueryWorker');
const Query = require('../query/Query');
const { hashObject } = require('../service/app.service');
const Rule = require('./Rule');

let count = 0;

module.exports = class Resolver {
  constructor(schema) {
    this.schema = schema;
    this.worker = new QueryWorker(this);
    this.loader = this.createLoader();

    Rule.factory('ensureId', () => (field, v) => {
      return this.match(field.getType()).id(v).one().then((doc) => {
        if (doc) return false;
        return true;
      });
    });
  }

  getContext() {
    return this.schema.getContext();
  }

  // Encapsulate Facebook DataLoader
  load(key) {
    const { method, model, query: q, args } = key;
    const query = new Query(this.toModel(model), q);

    switch (method) {
      case 'create': case 'update': case 'delete': case 'push': case 'pull': {
        return this.worker[method](query, ...args).then((results) => {
          this.loader.clearAll();
          return results;
        });
      }
      default: {
        return this.loader.load({ method, model, query, args });
      }
    }
  }

  // Public Data API
  clear(key) {
    return this.loader.clear(key);
  }

  clearAll() {
    return this.loader.clearAll();
  }

  prime(key, value) {
    return this.loader.prime(key, value);
  }

  match(model) {
    return new QueryBuilder(this.toModelEntity(model), this);
  }

  raw(model) {
    return this.toModelEntity(model).raw();
  }

  // Public Transaction API
  transaction(parentTxn) {
    const resolver = this;
    const txnMap = (parentTxn || {}).txnMap || (() => {
      let resolve, reject;
      const map = new TreeMap();
      map.promise = new Promise((good, bad) => { resolve = good; reject = bad; });
      map.resolve = resolve;
      map.reject = reject;

      map.ready = () => {
        const elements = map.elements();
        const notReady = elements.filter(el => !el.marker);
        if (notReady.length) return [undefined, undefined];
        let rollbackIndex = elements.findIndex(el => el.marker === 'rollback');
        if (rollbackIndex === -1) rollbackIndex = Infinity;
        return [elements.slice(0, rollbackIndex), elements.slice(rollbackIndex)];
      };

      map.perform = () => {
        const [commits, rollbacks] = map.ready();

        if (commits && rollbacks) {
          const rollbackData = flatten(rollbacks.map(tnx => tnx.data));
          const commitData = flatten(commits.map(tnx => tnx.data));

          Promise.all(rollbackData.map(rbd => rbd.$rollback())).then(() => {
            if (commits.length) resolver.clearAll();
            Promise.all(commitData.map(cd => cd.$commit())).then(d => map.resolve(d));
          }).catch(e => map.reject(e));
        }

        return map.promise;
      };

      return map;
    })();

    // Create txn
    const txn = ((data, driverMap, txMap, id) => {
      return {
        get match() {
          return (modelName) => {
            const model = resolver.toModelEntity(modelName);
            const driver = model.getDriver();
            if (!driverMap.has(driver)) driverMap.set(driver, []);
            const op = new TxnQueryBuilder(model, resolver, this);
            driverMap.get(driver).push(op);
            return op;
          };
        },
        get exec() {
          return () => {
            return Promise.all(Array.from(driverMap.entries()).map(([driver, ops]) => {
              if (driver.getConfig().transactions === false) {
                return Promise.all(ops.map(op => op.exec())).then((results) => {
                  results.$commit = () => resolver.clearAll();
                  results.$rollback = () => resolver.clearAll();
                  return results;
                });
              }

              return driver.transaction(ops);
            })).then((results) => {
              data = results;
              return flatten(results);
            });
          };
        },
        get run() {
          return () => {
            return this.exec().then((results) => {
              if (txMap.root(this) === this) return this.commit().then(() => results);
              this.commit();
              return results;
            }).catch((e) => {
              if (txMap.root(this) === this) return this.rollback().then(() => Promise.reject(e));
              this.rollback();
              throw e;
            });
          };
        },
        get commit() {
          return () => {
            if (this.marker !== 'rollback') this.marker = 'commit';
            return txMap.perform();
          };
        },
        get rollback() {
          return () => {
            this.marker = 'rollback';
            return txMap.perform();
          };
        },
        get data() {
          return data;
        },
        get txnMap() {
          return txMap;
        },
      };
    })([], new Map(), txnMap, count++);

    // Save txn to map
    txnMap.add(parentTxn, txn);

    // Return to caller
    return txn;
  }

  // Helpers
  toModel(model) {
    return model instanceof Model ? model : this.schema.getModel(model);
  }

  toModelEntity(model) {
    const entity = this.toModel(model);
    if (!entity) throw new Error(`${model} is not defined in schema`);
    if (!entity.isEntity()) throw new Error(`${model} is not an entity`);
    return entity;
  }

  createLoader() {
    return new FBDataLoader(keys => Promise.all(keys.map(({ method, query, args }) => this.worker[method](query, ...args))), {
      cacheKeyFn: ({ method, model, query }) => {
        return hashObject({ method, model: `${model}`, query: query.getCacheKey() });
      },
    });
  }
};
