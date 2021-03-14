const _ = require('lodash');
const DataResolver = require('../data/DataResolver');
const { map, globToRegexp, keyPaths, toGUID, getDeep, ensureArray } = require('./app.service');

exports.makeDataResolver = (doc, model, resolver) => {
  const { id } = doc;
  const guid = toGUID(model.getName(), id);
  const dataResolver = new DataResolver(doc, (data, prop) => model.resolve(data, prop, resolver));

  Object.entries(doc).forEach(([key, value]) => {
    const field = model.getFieldByKey(key);

    if (field && field.isEmbedded()) {
      const modelRef = field.getModelRef();
      if (modelRef) doc[key] = map(value, v => exports.makeDataResolver(v, modelRef, resolver));
    }
  });

  return Object.defineProperties(dataResolver, {
    id: { value: id, enumerable: true, writable: true },
    $id: { value: guid },
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
