const { flatten } = require('lodash');
const TreeMap = require('../data/TreeMap');

const Rule = require('./Rule');
const Model = require('../data/Model');
const DataLoader = require('../data/DataLoader');
// const DataTransaction = require('../data/DataTransaction');
const QueryBuilderTransaction = require('../query/QueryBuilderTransaction');
const QueryBuilder = require('../query/QueryBuilder');

module.exports = class Resolver {
  constructor(schema, context = {}) {
    this.schema = schema;
    this.context = context;
    this.loader = new DataLoader();
    this.schema.setContext(context);

    // DataLoader Proxy Methods
    this.clear = key => this.loader.clear(key);
    this.clearAll = () => this.loader.clearAll();
    this.prime = (key, value) => this.loader.prime(key, value);

    //
    this.getContext = () => this.context;

    //
    Rule.factory('ensureId', () => (field, v) => {
      return this.match(field.getType()).id(v).one().then((doc) => {
        if (doc) return false;
        return true;
      });
    }, {
      writable: true,
    });
  }

  /**
   * Creates and returns a QueryBuilder for a given model
   */
  match(model) {
    return new QueryBuilder(this, this.toModelEntity(model));
  }

  /**
   * Returns a user-defined Map (repository) of custom named queries.
   */
  named(model) {
    return this.toModel(model).getNamedQueries();
  }

  /**
   * Returns the raw client driver associated with the model.
   */
  raw(model) {
    return this.toModelEntity(model).raw();
  }

  // /**
  //  * Creates and returns a Transaction to run multiple queries
  //  */
  // transaction(parentTxn) {
  //   return new DataTransaction(this, parentTxn);
  // }

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
    const txn = ((data, driverMap, txMap) => {
      return {
        get match() {
          return (modelName) => {
            const model = resolver.toModelMarked(modelName);
            const driver = model.getDriver();
            if (!driverMap.has(driver)) driverMap.set(driver, []);
            const op = new QueryBuilderTransaction(resolver, model, parentTxn);
            driverMap.get(driver).push(op);
            return op;
          };
        },
        get exec() {
          return () => {
            return Promise.all(Array.from(driverMap.entries()).map(([driver, ops]) => {
              if (driver.getDirectives().transactions === false) {
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
    })([], new Map(), txnMap);

    // Save txn to map
    txnMap.add(parentTxn, txn);

    // Return to caller
    return txn;
  }

  resolve(query) {
    const { model, method } = query.toObject();

    switch (method) {
      case 'create': case 'update': case 'delete': {
        return model.getDriver().resolve(query.toDriver()).then((data) => {
          this.clearAll();
          return data;
        });
      }
      default: {
        return this.loader.load(query);
      }
    }
  }

  toModel(model) {
    const $model = model instanceof Model ? model : this.schema.getModel(model);
    return $model;
  }

  toModelMarked(model) {
    const marked = this.toModel(model);
    if (!marked) throw new Error(`${model} is not defined in schema`);
    if (!marked.isMarkedModel()) throw new Error(`${model} is not a marked model`);
    return marked;
  }

  toModelEntity(model) {
    const entity = this.toModel(model);
    if (!entity) throw new Error(`${model} is not defined in schema`);
    if (!entity.isEntity()) throw new Error(`${model} is not an entity`);
    return entity;
  }
};
