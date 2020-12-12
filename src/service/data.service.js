const _ = require('lodash');
const Boom = require('../core/Boom');
const DataResolver = require('../data/DataResolver');
const { createSystemEvent } = require('./event.service');
const { map, globToRegexp, isPlainObject, promiseChain, isIdValue, keyPaths, toGUID, getDeep, ensureArray, hashObject, mergeDeep, objectContaining } = require('./app.service');

exports.makeDataResolver = (doc, model, resolver, query) => {
  const { id } = doc;
  const guid = toGUID(model.getName(), id);
  const dataResolver = new DataResolver(doc, (data, prop) => model.resolve(data, prop, resolver, query));

  Object.entries(doc).forEach(([key, value]) => {
    const field = model.getFieldByName(key);

    if (field && field.isEmbedded()) {
      const modelRef = field.getModelRef();
      if (modelRef) doc[key] = map(value, v => exports.makeDataResolver(v, modelRef, resolver, query));
    }
  });

  if (id === undefined) return dataResolver;

  return Object.defineProperties(dataResolver, {
    id: { value: id, enumerable: true, writable: true },
    $id: { value: guid },
  });
};

exports.spliceEmbeddedArray = async (query, doc, key, from, to) => {
  const model = query.getModel();
  const field = model.getField(key);
  if (!field || !field.isArray()) return Promise.reject(Boom.badRequest(`Cannot splice field '${key}'`));

  const modelRef = field.getModelRef();
  const resolver = model.getResolver();
  const $from = model.transform({ [key]: from })[key];
  let $to = model.transform({ [key]: to })[key];

  // Edit
  if (from && to) {
    const arr = _.get(doc, key, []);
    if ($from.length > 1 && $to.length === 1) $to = Array.from($from).fill($to[0]);

    const edits = arr.map((el) => {
      return $from.reduce((prev, val, i) => {
        if (objectContaining(el, val)) return isPlainObject(prev) ? mergeDeep(prev, $to[i]) : $to[i];
        return prev;
      }, el);
    });

    if (field.isEmbedded()) {
      return Promise.all(edits.map((edit, i) => {
        if (hashObject(edit) !== hashObject(arr[i])) {
          return modelRef.appendDefaultValues(edit).then((input) => {
            return createSystemEvent('Mutation', { method: 'update', model: modelRef, resolver, query, input, parent: doc }, async () => {
              input = await modelRef.appendCreateFields(input, true);
              return modelRef.validateData(input, {}, 'update').then(() => input);
            });
          });
        }

        return Promise.resolve(edit);
      })).then((results) => {
        return { [key]: mergeDeep(edits, results) };
      });
    }

    return { [key]: edits };
  }

  // Pull
  if (from) {
    const data = { [key]: _.get(doc, key, []) };
    _.remove(data[key], el => $from.find(val => objectContaining(el, val)));
    return data;
  }

  // Push
  if (to) {
    if (field.isEmbedded()) {
      return Promise.all($to.map((el) => {
        return modelRef.appendDefaultValues(el).then((input) => {
          return createSystemEvent('Mutation', { method: 'create', model: modelRef, resolver, query, input, parent: doc }, async () => {
            input = await modelRef.appendCreateFields(input, true);
            return modelRef.validateData(input, {}, 'create').then(() => input);
          });
        });
      })).then((results) => {
        return { [key]: _.get(doc, key, []).concat(...results) };
      });
    }

    return { [key]: _.get(doc, key, []).concat($to) };
  }
};

// exports.resolveModelWhereClause = async (resolver, model, where = {}, options = {}) => {
//   const $where = await exports.resolveModelWhereClause2(resolver, model, where);

//   Object.entries(where).forEach(([key, value]) => {
//     if (Object.prototype.hasOwnProperty.call($where, key)) {
//       const $value = $where[key];
//       if (!ensureArray($value).some($v => hashObject($v) === hashObject(value))) $where[key] = 'there-is-a-mismatch-here';
//     }
//   });

//   return $where;
// };

exports.resolveModelWhereClause = (resolver, model, where = {}, fieldKey = '', lookups2D = [], index = 0) => {
  const mName = model.getName();
  const fields = model.getFields();

  // Allowing id in where clause
  if (where.id) where.id = map(where.id, v => model.idValue(v));

  //
  lookups2D[index] = lookups2D[index] || {
    parentFieldKey: fieldKey,
    parentModel: model,
    parentFields: fields,
    parentDataRefs: new Set(model.getDataRefFields().map(f => f.getDataRef())),
    lookups: [],
  };

  const resolveEmbeddedWhere = (ref, key, value) => {
    const resolved = ensureArray(map(value, (obj) => {
      return Object.entries(obj).reduce((p, [k, v]) => {
        const f = ref.getFieldByName(k);

        if (k === 'id') return Object.assign(p, { [k]: ref.idValue(v) });
        if (f.isScalar()) return Object.assign(p, { [k]: v });
        if (f.isEmbedded()) return Object.assign(p, { [k]: resolveEmbeddedWhere(f.getModelRef(), k, v) });
        return Object.assign(p, { [k]: v });
      }, {});
    }));

    return resolved.length > 1 ? resolved : resolved[0];
  };

  // Depth first traversal to create 2d array of lookups
  lookups2D[index].lookups.push({
    modelName: mName,
    query: Object.entries(where).reduce((prev, [key, value]) => {
      const field = model.getField(key);
      const ref = field.getModelRef();

      if (field.isEmbedded()) {
        value = resolveEmbeddedWhere(ref, key, value);
      } else if (ref) {
        if (isPlainObject(value)) {
          exports.resolveModelWhereClause(resolver, ref, value, key, lookups2D, index + 1);
          return prev;
        }

        if (Array.isArray(value)) {
          const scalars = [];
          const norm = value.map((v) => {
            if (isPlainObject(v)) return v;
            if (field.isVirtual() && isIdValue(v)) return { id: v };
            scalars.push(v);
            return null;
          }).filter(v => v);
          norm.forEach(val => exports.resolveModelWhereClause(resolver, ref, val, field, lookups2D, index + 1));
          if (scalars.length) prev[key] = scalars;
          return prev;
        }

        if (field.isVirtual()) {
          exports.resolveModelWhereClause(resolver, ref, { id: value }, field, lookups2D, index + 1);
          return prev;
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
        const { parentModel: currentModel, parentFields: currentFields, parentFieldKey: currentFieldKey } = lookups2D[index2D];

        return resolver.match(modelName).where(query).many({ find: true }).then((results) => {
          if (parentDataRefs.has(modelName)) {
            parentLookup.lookups.forEach((lookup) => {
              // Anything with type `modelName` should be added to query
              parentFields.forEach((field) => {
                const ref = field.getDataRef();

                if (ref === modelName) {
                  if (field.isVirtual()) {
                    const cField = currentFields.find(f => f.getName() === field.getVirtualRef());
                    // const cKey = cField.getKey(field.getVirtualRef());

                    Object.assign(lookup.query, {
                      id: results.map((result) => {
                        const cValue = result[cField];
                        return parentModel.idValue(cValue);
                      }),
                    });
                  } else {
                    Object.assign(lookup.query, {
                      [currentFieldKey]: results.map(result => currentModel.idValue(result.id)),
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
      const vals = ensureArray(getDeep(doc, path, defaultValue)).sort();
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
    const realVals = ensureArray(getDeep(doc, realPath));
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
