const { get } = require('lodash');
const { map, keyPaths } = require('../service/app.service');
const { makeDataResolver } = require('../service/data.service');

module.exports = class QueryResult {
  constructor(query, data) {
    const { model, resolver, select = {}, sort } = query.toObject();

    // Select fields
    const selectFields = Object.keys(select).map(f => model.getField(f).getName()).concat('id').concat(model.idKey());

    const results = map(data, (doc) => {
      // Delete fields not selected (you do not want to deserialize everything)
      Object.keys(doc).forEach((key) => {
        if (selectFields.indexOf(key) === -1) delete doc[key];
      });

      // Deserialize and continue
      doc = model.deserialize(doc);
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
