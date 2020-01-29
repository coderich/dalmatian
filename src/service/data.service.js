const _ = require('lodash');
const { ObjectID } = require('mongodb');
const RuleService = require('../service/rule.service');
const { BadRequestError } = require('../service/error.service');
const { uniq, globToRegexp, isScalarValue, isPlainObject, promiseChain, isIdValue, keyPaths, toGUID, getDeep } = require('../service/app.service');

exports.validateModelData = (resolver, model, data, oldData, op) => {
  const promises = [];
  const modelName = model.getName();
  const fields = model.getFields();

  fields.forEach((field) => {
    const key = field.getName();
    const rules = field.getRules() || [];
    const ref = field.getModelRef();
    const isTypeArray = field.isArray();
    const value = data[key];
    const path = `${modelName}.${key}`;
    const isValueArray = Array.isArray(value);

    // User-Defined Validation Rules
    const immutable = v => RuleService.immutable()(v, oldData, op, path);
    const selfless = v => RuleService.selfless()(v, oldData, op, path);
    const required = (op === 'create' ? v => v == null : v => v === null);
    field.validate(value, { required, selfless, immutable });

    // if (value == null || isScalarValue(value) || value instanceof ObjectID) {
    //   rules.forEach(rule => rule(value, oldData, op, path));
    // }

    // The data may not be defined for this key
    if (!Object.prototype.hasOwnProperty.call(data, key)) return;

    // Data type check
    if (isValueArray !== isTypeArray) throw new BadRequestError(`${path} invalid array`);

    // Recursive/Promises lookup
    if (isValueArray) {
      if (ref) {
        if (field.isEmbedded()) {
          promises.push(...value.map(v => exports.validateModelData(resolver, ref, v, oldData, op)));
        } else {
          promises.push(...value.map(v => resolver.spot(ref).id(v).one({ required: true })));
          // value.forEach(v => rules.forEach(rule => rule(v, oldData, op, path)));
        }
      } else {
        // value.forEach(v => rules.forEach(rule => rule(v, oldData, op, path)));
      }
    } else if (ref) {
      if (field.isEmbedded()) {
        promises.push(exports.validateModelData(resolver, ref, value, oldData, op));
      } else {
        promises.push(resolver.spot(ref).id(value).one({ required: true }));
      }
    }
  });

  return Promise.all(promises);
};

exports.ensureModelArrayTypes = (resolver, model, data) => {
  return Object.entries(data).reduce((prev, [key, value]) => {
    const field = model.getField(key);
    if (value == null || field == null) return prev;

    // Ensure array if type array
    if (field.isArray() && !Array.isArray(value)) prev[key] = [value];

    return prev;
  }, data);
};

exports.applyFieldValueTransform = (field, value) => {
  const type = field.getSimpleType();
  const transforms = field.getTransforms() || [];

  switch (type) {
    case 'String': {
      value = `${value}`;
      break;
    }
    case 'Number': case 'Float': case 'Int': {
      const num = Number(value);
      if (!Number.isNaN(num)) value = num;
      break;
    }
    case 'Boolean': {
      if (value === 'true') value = true;
      if (value === 'false') value = false;
      break;
    }
    default: {
      break;
    }
  }

  // Transforming
  transforms.forEach(t => (value = t(value)));

  return value;
};

exports.normalizeModelWhere = (resolver, model, data) => {
  return Object.entries(data).reduce((prev, [key, value]) => {
    const field = model.getField(key);
    if (value == null || field == null) return prev;

    const ref = field.getModelRef();

    if (ref) {
      if (isPlainObject(value)) {
        prev[key] = exports.normalizeModelWhere(resolver, ref, value);
      } else if (Array.isArray(value)) {
        prev[key] = value.map((val) => {
          if (isPlainObject(val)) return exports.normalizeModelWhere(resolver, ref, val);
          if (isIdValue(val)) return ref.idValue(val);
          return val;
        });
      } else {
        prev[key] = ref.idValue(value);
      }
    } else if (Array.isArray(value)) {
      prev[key] = value.map(val => exports.applyFieldValueTransform(field, val));
    } else {
      prev[key] = exports.applyFieldValueTransform(field, value);
    }

    return prev;
  }, data);
};

exports.normalizeModelData = (resolver, model, data) => {
  return Object.entries(data).reduce((prev, [key, value]) => {
    const field = model.getField(key);
    if (value == null || field == null) return prev;

    const ref = field.getModelRef();
    const type = field.getDataType();

    if (isPlainObject(value) && ref) {
      prev[key] = exports.normalizeModelData(resolver, ref, value);
    } else if (Array.isArray(value)) {
      if (ref) {
        if (field.isEmbedded() || field.isVirtual()) {
          prev[key] = value.map(v => exports.normalizeModelData(resolver, ref, v));
        } else if (type.isSet) {
          prev[key] = uniq(value).map(v => ref.idValue(v));
        } else {
          prev[key] = value.map(v => ref.idValue(v));
        }
      } else {
        prev[key] = value.map(v => exports.applyFieldValueTransform(field, v));
        if (type.isSet) prev[key] = uniq(prev[key]);
      }
    } else if (ref) {
      prev[key] = ref.idValue(value);
    } else {
      prev[key] = exports.applyFieldValueTransform(field, value);
    }

    return prev;
  }, data);
};

exports.resolveModelWhereClause = (resolver, model, where = {}, fieldAlias = '', lookups2D = [], index = 0) => {
  const mName = model.getName();
  const fields = model.getFields();

  //
  lookups2D[index] = lookups2D[index] || {
    parentFieldAlias: fieldAlias,
    parentModel: model,
    parentFields: fields,
    parentDataRefs: new Set(model.getDataRefFields().map(f => f.getDataRef())),
    lookups: [],
  };

  // Depth first traversal to create 2d array of lookups
  lookups2D[index].lookups.push({
    modelName: mName,
    query: Object.entries(where).reduce((prev, [key, value]) => {
      const field = model.getField(key);

      if (field && !field.isEmbedded()) {
        const ref = field.getModelRef();

        if (ref) {
          if (isPlainObject(value)) {
            exports.resolveModelWhereClause(resolver, ref, value, field.getAlias(key), lookups2D, index + 1);
            return prev;
          }

          if (Array.isArray(value)) {
            const scalars = [];
            const norm = value.map((v) => {
              if (isPlainObject(v)) return v;
              if (field.isVirtual() && isIdValue(v)) return { [ref.idField()]: v };
              scalars.push(v);
              return null;
            }).filter(v => v);
            norm.forEach(val => exports.resolveModelWhereClause(resolver, ref, val, field.getAlias(key), lookups2D, index + 1));
            if (scalars.length) prev[key] = scalars;
            return prev;
          }

          if (field.isVirtual()) {
            exports.resolveModelWhereClause(resolver, ref, { [ref.idField()]: value }, field.getAlias(key), lookups2D, index + 1);
            return prev;
          }
        }
      }

      return Object.assign(prev, { [key]: value });
    }, {}),
  });

  if (index === 0) {
    if (lookups2D.length === 1) {
      const [{ query }] = lookups2D[0].lookups;
      return query;
    }

    return promiseChain(lookups2D.reverse().map(({ lookups }, index2D) => {
      return () => Promise.all(lookups.map(async ({ modelName, query }) => {
        const parentLookup = lookups2D[index2D + 1] || { parentDataRefs: new Set() };
        const { parentModel, parentFields, parentDataRefs } = parentLookup;
        const { parentModel: currentModel, parentFields: currentFields, parentFieldAlias: currentFieldAlias } = lookups2D[index2D];

        return resolver.spot(modelName).where(query).many({ find: true }).then((results) => {
          if (parentDataRefs.has(modelName)) {
            parentLookup.lookups.forEach((lookup) => {
              // Anything with type `modelName` should be added to query
              parentFields.forEach((field) => {
                const ref = field.getDataRef();

                if (ref === modelName) {
                  if (field.isVirtual()) {
                    const cField = currentFields.find(f => f.getName() === field.getVirtualRef());
                    const cAlias = cField.getAlias(field.getVirtualRef());

                    Object.assign(lookup.query, {
                      [parentModel.idField()]: results.map((result) => {
                        const cValue = result[cAlias];
                        return parentModel.idValue(cValue);
                      }),
                    });
                  } else {
                    Object.assign(lookup.query, {
                      [currentFieldAlias]: results.map(result => currentModel.idValue(result.id)),
                    });
                  }
                }
              });
            });
          }

          return results;
        });
      }));
    })).then(() => {
      const [{ query }] = lookups2D[lookups2D.length - 1].lookups;
      return query;
    });
  }

  // Must be a nested call; nothing to do
  return undefined;
};

exports.resolveReferentialIntegrity = (resolver, model, query, parentTxn) => {
  const id = query.getId();
  const txn = resolver.transaction(parentTxn);

  return new Promise(async (resolve, reject) => {
    try {
      model.referentialIntegrity().forEach(({ model: ref, field, fieldRef, isArray, op }) => {
        const fieldStr = fieldRef ? `${field}.${fieldRef}` : `${field}`;
        const $where = { [fieldStr]: id };

        // console.log(`${ref}`, $where, op, isArray, fieldStr);

        switch (op) {
          case 'cascade': {
            if (isArray) {
              txn.spot(ref).where($where).pull(fieldStr, id);
            } else {
              txn.spot(ref).where($where).remove(txn);
            }
            break;
          }
          case 'nullify': {
            txn.spot(ref).where($where).save({ [fieldStr]: null });
            break;
          }
          case 'restrict': {
            txn.spot(ref).where($where).count().then(count => (count ? reject(new Error('Restricted')) : count));
            break;
          }
          default: throw new Error(`Unknown onDelete operator: '${op}'`);
        }
      });

      // Execute the transaction
      txn.run().then(results => resolve(results)).catch(e => reject(e));
    } catch (e) {
      txn.rollback().then(() => reject(e)).catch(err => reject(err));
    }
  });
};

exports.sortData = (data, sortBy) => {
  const paths = keyPaths(sortBy);

  const info = paths.reduce((prev, path, i) => {
    const order = _.get(sortBy, path, 'asc').toLowerCase();

    prev.iteratees.push((doc) => {
      const defaultValue = path.indexOf('count') > -1 ? 0 : null;
      const vals = getDeep(doc, path, defaultValue).sort();
      const tuple = [vals[0], vals[vals.length - 1]];
      return order === 'asc' ? tuple[0] : tuple[1];
    });

    prev.orders.push(order);
    return prev;
  }, {
    iteratees: [],
    orders: [],
  });

  return _.orderBy(data, info.iteratees.concat('$id'), info.orders.concat('asc')).map((doc, i) => {
    const cursor = toGUID(i, doc.$id);
    if (!Object.prototype.hasOwnProperty.call(doc, '$$cursor')) return Object.defineProperty(doc, '$$cursor', { writable: true, value: cursor });
    doc.$$cursor = cursor;
    return doc;
  });
};

exports.filterDataByCounts = (resolver, model, data, countPaths) => {
  const pathValue = (doc, path) => {
    const realPath = path.split('.').map(s => (s.indexOf('count') === 0 ? s : `$${s}`)).join('.');
    const realVals = getDeep(doc, realPath);
    return realVals;
  };

  return data.filter(doc => Object.entries(countPaths).every(([path, value]) => pathValue(doc, path).some(el => String(el).match(globToRegexp(value)))));
};

exports.paginateResults = (results = [], pagination = {}) => {
  const { before, after, first = Infinity, last = 0 } = pagination;
  if (first < 0 || last < 0) throw new Error('Invalid first|last pagination');

  const totalCount = results.length;
  const cursors = results.map(result => result.$$cursor);
  const afterIndex = cursors.findIndex(cursor => Boolean(cursor >= after)); // Want edges after this index
  let beforeIndex = cursors.findIndex(cursor => Boolean(cursor >= before)); // Want edges before this index
  if (beforeIndex === -1) beforeIndex = Infinity;
  const edges = results.slice(afterIndex + 1, beforeIndex);
  const hasPreviousPage = Boolean(last ? (edges.length > last) : (after && afterIndex));
  const hasNextPage = Boolean(first !== Infinity ? (edges.length > first) : (before && beforeIndex < results.length));
  const slice = edges.slice(0, first).slice(-last);

  return Object.defineProperty(slice, '$$pageInfo', {
    value: {
      startCursor: _.get(slice, '0.$$cursor', ''),
      endCursor: _.get(slice, `${slice.length - 1}.$$cursor`, ''),
      hasPreviousPage,
      hasNextPage,
      totalCount,
    },
  });
};
