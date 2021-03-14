const { get } = require('lodash');
const { map, keyPaths } = require('../service/app.service');
const { makeDataResolver } = require('../service/data.service');

module.exports = class QueryResult {
  constructor(query, data) {
    const { model, resolver, sort } = query.toObject();

    const results = map(data, (doc) => {
      const sortPaths = keyPaths(sort);
      const sortValues = sortPaths.reduce((prev, path) => Object.assign(prev, { [path]: get(doc, path) }), {});
      const sortJSON = JSON.stringify(sortValues);
      const cursor = Buffer.from(sortJSON).toString('base64');
      const dataResolver = makeDataResolver(doc, model, resolver);
      return Object.defineProperty(dataResolver, '$$cursor', { writable: true, value: cursor });
    });

    return results;
  }
};
