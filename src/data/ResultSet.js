const { keyPaths, mapPromise, lcFirst, ensureArray } = require('../service/app.service');
const { makeDataResolver } = require('../service/data.service');

module.exports = class {
  constructor(model, promise) {
    this.model = model;
    this.promise = promise;

    // Object.defineProperties(promise, {
    //   hydrate: {}, // Entire result set
    //   populate: {}, // One attribute
    // });
  }

  async hydrate(resolver, query) {
    return this.getResults(resolver, query).then(async (results) => {
      const paths = [...new Set([...keyPaths(query.getSortFields())])]; // Only need sortFields for hydrating (get rid of this)

      return Promise.all(ensureArray(results).map((doc) => {
        return Promise.all(paths.map((path) => {
          return path.split('.').reduce((promise, prop) => {
            return promise.then((subdoc) => {
              if (subdoc == null) return Promise.resolve(subdoc);
              if (Array.isArray(subdoc)) return Promise.all(subdoc.map(sd => Promise.resolve(sd[prop])));
              return Promise.resolve(subdoc[prop]);
            });
          }, Promise.resolve(doc));
        }));
      })).then(() => results);
    });
  }

  getResults(resolver, query) {
    return this.promise.then((results) => {
      return mapPromise(results, (result) => {
        return Promise.resolve(this.model.deserialize(result)).then((doc) => {
          return makeDataResolver(doc, this.model, resolver, query);
        });
      }).then((data) => {
        return data;
      });
    });
  }

  getCountField(prop) {
    const [, countProp] = prop.split('count').map(v => lcFirst(v));
    return this.model.getField(countProp);
  }
};
