const _ = require('lodash');
const RuleService = require('../service/rule.service');
const { globToRegexp, isPlainObject, promiseChain, isIdValue, keyPaths, toGUID, unravelObject, getDeep } = require('../service/app.service');

exports.validateModelData = (model, data, oldData, op) => {
  const required = (op === 'create' ? (f, v) => v == null : (f, v) => v === null);
  const immutable = (f, v) => RuleService.immutable(v, oldData, op, `${f.getModel()}.${f.getName()}`);
  const selfless = (f, v) => RuleService.selfless(v, oldData, op, `${f.getModel()}.${f.getName()}`);
  return model.validate(data, { required, immutable, selfless });
};

// exports.resolveModelWhereClause = (resolver, model, where = {}) => {
//   const wherePaths = keyPaths(where);
//   if (!wherePaths.length) return where;

//   // Remove redundant paths
//   const uniqPaths = wherePaths.filter((path, i, arr) => arr.some((el, j) => Boolean(i === j || el.indexOf(path) !== 0)));
//   const maxDepth = Math.max(...uniqPaths.map(path => path.split('.').length));

//   // If we're flat we're done
//   if (maxDepth === 1) {
//     return Object.entries(where).reduce((prev, [key, value]) => {
//       const field = model.getField(key);
//       const alias = field ? field.getAlias() : key;
//       return Object.assign(prev, { [alias]: value });
//     }, {});
//   }

//   return promiseChain(Array.from(Array(maxDepth)).map((e, i) => {
//     return () => {
//       const depth = maxDepth - i;
//       const depthPaths = uniqPaths.filter(path => path.split('.').length === depth);
//       if (!depthPaths.length) return Promise.resolve({});

//       return Promise.all(depthPaths.map((path) => {
//         const segments = path.split('.');
//         const [segModel, segField] = segments.slice(-2);
//         const lookupValue = _.get(where, path);
//         const currentModel = segments.slice(0, -1).reduce((m, f) => m.getField(f).getModelRef(), model);
//         const currentField = currentModel.getField(segField);
//         const parentModel = segments.slice(0, -2).reduce((m, f) => m.getField(f).getModelRef(), model);
//         const parentField = parentModel.getField(segModel);

//         const lookupModel = currentField.isVirtual() ? currentField.getModelRef() : currentModel;
//         const lookupField = currentField.isVirtual() ? lookupModel.getField('id') : currentField;

//         console.log(`${path}: Looking up ${lookupModel}.${lookupField} === ${lookupValue}`);

//         return resolver.match(lookupModel).where({ [lookupField.getAlias()]: lookupValue }).many().then((results) => {
//           const offset = currentField.isVirtual() ? -1 : -2;
//           const prop = parentField.isVirtual() ? parentField.getVirtualField() : 'id';
//           const key = segments.slice(0, offset).join('.') || 'id';
//           const value = results.map(r => r[prop]);
//           return exports.resolveModelWhereClause(resolver, model, unravelObject({ [key]: value }));
//         });
//       })).then((results) => {
//         console.log('intermediate results', JSON.stringify(results));
//         return results.pop();
//       });
//     };
//   })).then((results) => {
//     return results.reduce((prev, result) => {
//       return Object.assign(prev, result);
//     }, {});
//   });
// };

// exports.resolveModelWhereClause = (resolver, model, where = {}) => {
//   const wherePaths = keyPaths(where);
//   if (!wherePaths.length) return where;

//   // Remove redundant paths; sort by depth
//   const uniqPaths = wherePaths.filter((path, i, arr) => arr.some((el, j) => Boolean(i === j || el.indexOf(path) !== 0))).sort((a, b) => a.length - b.length);
//   const maxDepth = Math.max(...uniqPaths.map(path => path.split('.').length));

//   // If we're flat we're done
//   if (maxDepth === 1) {
//     return Object.entries(where).reduce((prev, [key, value]) => {
//       const field = model.getField(key);
//       const alias = field ? field.getAlias() : key;
//       return Object.assign(prev, { [alias]: value });
//     }, {});
//   }

//   return promiseChain(uniqPaths.map((path) => {
//     return () => {
//       const segments = path.split('.');
//       const [segModel, segField] = segments.slice(-2);
//       const lookupValue = _.get(where, path);
//       const currentModel = segments.slice(0, -1).reduce((m, f) => m.getField(f).getModelRef(), model);
//       const currentField = currentModel.getField(segField);
//       const parentModel = segments.slice(0, -2).reduce((m, f) => m.getField(f).getModelRef(), model);
//       const parentField = parentModel.getField(segModel);

//       const lookupModel = currentField.isVirtual() ? currentField.getModelRef() : currentModel;
//       const lookupField = currentField.isVirtual() ? lookupModel.getField('id') : currentField;

//       console.log(`${path}: Looking up ${lookupModel}.${lookupField} === ${lookupValue}`);
//       console.log(`currentField ${currentField}`);

//       return resolver.match(lookupModel).where({ [lookupField.getAlias()]: lookupValue }).many().then((results) => {
//         const offset = currentField.isVirtual() ? -1 : -2;
//         const prop = parentField.isVirtual() ? parentField.getVirtualField() : 'id';
//         const key = segments.slice(0, offset).join('.') || 'id';
//         const value = results.map(r => r[prop]);
//         return exports.resolveModelWhereClause(resolver, model, unravelObject({ [key]: value }));
//       });
//     };
//   })).then((results) => {
//     return results.pop();
//   });
// };

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

        return Object.assign(prev, { [field.getAlias(key)]: value });
      }

      return Object.assign(prev, { [field.getAlias(key)]: value });
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

        return resolver.match(modelName).where(query).many({ find: true }).then((results) => {
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

        switch (op) {
          case 'cascade': {
            if (isArray) {
              txn.match(ref).where($where).pull(fieldStr, id);
            } else {
              txn.match(ref).where($where).remove(txn);
            }
            break;
          }
          case 'nullify': {
            txn.match(ref).where($where).save({ [fieldStr]: null });
            break;
          }
          case 'restrict': {
            txn.match(ref).where($where).count().then(count => (count ? reject(new Error('Restricted')) : count));
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

  return _.orderBy(data, info.iteratees.concat('id'), info.orders.concat('asc')).map((doc, i) => {
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
  const applyCursorsToEdges = (allEdges, before, after) => {
    const edges = [...allEdges];

    if (after) {
      const afterEdge = edges.findIndex(edge => edge.$$cursor === after);
      if (afterEdge > -1) edges.splice(0, afterEdge + 1);
    }

    if (before) {
      const beforeEdge = edges.findIndex(edge => edge.$$cursor === before);
      if (beforeEdge > -1) edges.splice(beforeEdge);
    }

    return edges;
  };

  const edgesToReturn = (allEdges, before, after, first, last) => {
    const edges = applyCursorsToEdges(allEdges, before, after);

    if (first) {
      if (first < 0) throw new Error();
      if (edges.length > first) edges.splice(first);
    }

    if (last) {
      if (last < 0) throw new Error();
      if (edges.length > last) edges.splice(0, edges.length - last);
    }

    return edges;
  };

  const hasPreviousPage = (allEdges, before, after, first, last) => {
    if (last) {
      const edges = applyCursorsToEdges(allEdges, before, after);
      return Boolean(edges.length > last);
    }

    if (after) {
      const index = allEdges.findIndex(edge => edge.$$cursor <= after);
      return Boolean(index > -1);
    }

    return false;
  };

  const hasNextPage = (allEdges, before, after, first, last) => {
    if (first) {
      const edges = applyCursorsToEdges(allEdges, before, after);
      return Boolean(edges.length > first);
    }

    if (before) {
      const index = allEdges.findIndex(edge => edge.$$cursor >= before);
      return Boolean(index > -1);
    }

    return false;
  };

  const { before, after, first, last } = pagination;
  const edges = edgesToReturn(results, before, after, first, last);

  return Object.defineProperty(edges, '$$pageInfo', {
    value: {
      startCursor: _.get(edges, '0.$$cursor', ''),
      endCursor: _.get(edges, `${edges.length - 1}.$$cursor`, ''),
      hasPreviousPage: hasPreviousPage(results, before, after, first, last),
      hasNextPage: hasNextPage(results, before, after, first, last),
      totalCount: results.length,
    },
  });

  // const { before, after, first = Infinity, last = 0 } = pagination;
  // if (first < 0 || last < 0) throw new Error('Invalid first|last pagination');

  // const totalCount = results.length;
  // const cursors = results.map(result => result.$$cursor);
  // const afterIndex = cursors.findIndex(cursor => Boolean(cursor >= after)); // Want edges after this index
  // let beforeIndex = cursors.findIndex(cursor => Boolean(cursor >= before)); // Want edges before this index
  // if (beforeIndex === -1) beforeIndex = Infinity;
  // const edges = results.slice(afterIndex + 1, beforeIndex);
  // const hasPreviousPage = Boolean(last ? (edges.length > last) : (after && afterIndex > 0));
  // const hasNextPage = Boolean(first !== Infinity ? (edges.length > first) : (before && beforeIndex < results.length));
  // const slice = edges.slice(0, first).slice(-last);

  // return Object.defineProperty(slice, '$$pageInfo', {
  //   value: {
  //     startCursor: _.get(slice, '0.$$cursor', ''),
  //     endCursor: _.get(slice, `${slice.length - 1}.$$cursor`, ''),
  //     hasPreviousPage,
  //     hasNextPage,
  //     totalCount,
  //   },
  // });
};
