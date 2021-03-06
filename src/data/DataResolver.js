/**
 * DataResolver.
 *
 * A simple Proxy to allow dynamic lazy-loading of data attributes. It's primary use is to hydrate
 * data from the database on demand.
 */
module.exports = class DataResolver {
  constructor(data, resolver = (d, p) => d[p]) {
    if (data == null) return data;

    return new Proxy(data, {
      get(target, prop, rec) {
        const value = Reflect.get(target, prop, rec);
        if (typeof value === 'function') return value.bind(target);
        return resolver(data, prop);
      },
    });
  }
};
