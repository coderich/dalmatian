const _ = require('lodash');
const PicoMatch = require('picomatch');
const FillRange = require('fill-range');
const DeepMerge = require('deepmerge');
const { ObjectID } = require('mongodb');
const ObjectHash = require('object-hash');

const overwriteMerge = (d, s, o) => s;

const smartMerge = (d, s, o) => {
  if (d.length !== s.length) return s;

  return d.map((el, i) => {
    const val = s[i];
    if (exports.isScalarValue(el) || exports.isScalarValue(val)) return val;
    return exports.mergeDeep(el, val);
  });
};

const combineMerge = (target, source, options) => {
  const destination = target.slice();

  source.forEach((item, index) => {
    if (typeof destination[index] === 'undefined') {
      destination[index] = options.cloneUnlessOtherwiseSpecified(item, options);
    } else if (options.isMergeableObject(item)) {
      destination[index] = DeepMerge(target[index], item, options);
    } else if (target.indexOf(item) === -1) {
      destination.push(item);
    }
  });

  return destination;
};

exports.id = '3d896496-02a3-4ee5-8e42-2115eb215f7e';
exports.ucFirst = string => string.charAt(0).toUpperCase() + string.slice(1);
exports.lcFirst = string => string.charAt(0).toLowerCase() + string.slice(1);
exports.isPlainObject = obj => obj != null && typeof obj === 'object' && !Array.isArray(obj) && !(obj instanceof ObjectID) && !(obj instanceof Date);
exports.isScalarValue = value => typeof value !== 'object' && typeof value !== 'function';
exports.isScalarDataType = value => ['ID', 'String', 'Float', 'Int', 'Boolean', 'DateTime'].indexOf(value) > -1;
exports.isIdValue = value => exports.isScalarValue(value) || value instanceof ObjectID;
exports.mergeDeep = (...args) => DeepMerge.all(args, { isMergeableObject: obj => (exports.isPlainObject(obj) || Array.isArray(obj)), arrayMerge: overwriteMerge });
exports.mergeDeepAll = (...args) => DeepMerge.all(args, { isMergeableObject: obj => (exports.isPlainObject(obj) || Array.isArray(obj)), arrayMerge: combineMerge });
exports.uniq = arr => [...new Set(arr.map(a => `${a}`))];
exports.timeout = ms => new Promise(res => setTimeout(res, ms));
exports.hashObject = obj => ObjectHash(obj, { respectType: false, respectFunctionNames: false, respectFunctionProperties: false, unorderedArrays: true, ignoreUnknown: true, replacer: r => (r instanceof ObjectID ? `${r}` : r) });
exports.globToRegex = (glob, options = {}) => PicoMatch.makeRe(glob, { maxLength: 100, ...options, expandRange: (a, b) => `(${FillRange(a, b, { toRegex: true })})` });
exports.globToRegexp = (glob, options = {}) => PicoMatch.toRegex(exports.globToRegex(glob, options));
exports.toGUID = (model, id) => Buffer.from(`${model},${`${id}`}`).toString('base64');
exports.fromGUID = guid => Buffer.from(`${guid}`, 'base64').toString('ascii').split(',');
exports.guidToId = (autograph, guid) => (autograph.legacyMode ? guid : exports.fromGUID(guid)[1]);
exports.ensureArray = a => (Array.isArray(a) ? a : [a].filter(el => el !== undefined));
exports.uvl = (...values) => values.reduce((prev, value) => (prev === undefined ? value : prev), undefined);
exports.nvl = (...values) => values.reduce((prev, value) => (prev === null ? value : prev), null);
exports.stripObjectNulls = obj => Object.entries(obj).reduce((prev, [key, value]) => (value == null ? prev : Object.assign(prev, { [key]: value })), {});
exports.pushIt = (arr, it) => arr[arr.push(it) - 1];
exports.toKeyObj = obj => exports.keyPaths(obj).reduce((prev, path) => Object.assign(prev, { [path]: _.get(obj, path) }), {});
exports.hashCacheKey = ({ method, model, query, args }) => exports.hashObject({ method, model: `${model}`, query: query.getCacheKey(), args });

exports.removeUndefinedDeep = (obj) => {
  return exports.unravelObject(exports.keyPaths(obj).reduce((prev, path) => {
    const value = _.get(obj, path);
    if (value === undefined) return prev;
    return Object.assign(prev, { [path]: value });
  }, {}));
};

exports.renameObjectKey = (obj, oldKey, newKey) => {
  if (oldKey !== newKey) {
    Object.defineProperty(obj, newKey, Object.getOwnPropertyDescriptor(obj, oldKey));
    delete obj[oldKey];
  }
};

exports.getDeep = (obj, path, defaultValue) => {
  const [prop, ...rest] = path.split('.');
  const normalize = data => (Array.isArray(data) ? _.flatten(data) : data);

  return exports.map(obj, (o) => {
    const value = o[prop];
    if (rest.length) return normalize(exports.map(value, v => exports.getDeep(v, rest.join('.'), defaultValue)));
    return value === undefined ? defaultValue : value;
  });
};

exports.map = (mixed, fn) => {
  if (mixed == null) return mixed;
  const isArray = Array.isArray(mixed);
  const arr = isArray ? mixed : [mixed];
  const results = arr.map(el => fn(el));
  return isArray ? results : results[0];
};

exports.mapPromise = (mixed, fn) => {
  const map = exports.map(mixed, fn);
  return Array.isArray(map) ? Promise.all(map) : Promise.resolve(map);
};

exports.castCmp = (type, value) => {
  switch (type) {
    case 'String': {
      return `${value}`;
    }
    case 'Float': case 'Number': {
      const num = Number(value);
      if (!Number.isNaN(num)) return num;
      return value;
    }
    case 'Int': {
      const num = parseInt(value, 10);
      if (!Number.isNaN(num)) return num;
      return value;
    }
    case 'Boolean': {
      if (value === 'true') return true;
      if (value === 'false') return false;
      return value;
    }
    default: {
      return value;
    }
  }
};

exports.objectContaining = (a, b) => {
  if (a === b) return true;

  if (exports.isPlainObject(b)) {
    return exports.keyPathLeafs(b).every((leaf) => {
      const $a = _.get(a, leaf, { a: 'a' });
      const $b = _.get(b, leaf, { b: 'b' });
      if (Array.isArray($b)) return $b.some(bb => exports.ensureArray($a).some(aa => exports.objectContaining(aa, bb)));
      if (exports.isScalarValue($a) && exports.isScalarValue($b)) return PicoMatch.isMatch(`${$a}`, `${$b}`, { nocase: true });
      return exports.hashObject($a) === exports.hashObject($b);
    });
  }

  return exports.hashObject(a) === exports.hashObject(b);
};

exports.serialize = (field, value) => {
  if (!exports.isPlainObject(value)) return value;
  const model = field.getModelRef();
  if (!model) return value;
  const key = model.idKey();
  return value[key];
};

/**
 * Transform an object with dot.notation keys into an expanded object.
 * eg. { 'user.name': 'richard' } => { user: { name: 'richard' } }
 */
exports.unravelObject = (obj) => {
  if (obj == null) return obj;

  return exports.keyPaths(obj).reduce((prev, path) => {
    const splitPath = path.split('.');

    return _.set(prev, path, _.get(obj, path, splitPath.reduce((val, p, i) => {
      if (val !== undefined) return val;
      const tuple = [splitPath.slice(0, i + 1).join('.'), splitPath.slice(i + 1).join('.')];
      return _.get(obj, tuple);
    }, undefined)));
  }, {});
};

exports.unrollGuid = (autograph, model, data) => {
  if (autograph.legacyMode) return data;
  model = autograph.resolver.toModel(model);
  const fields = model.getDataRefFields().map(field => field.getName());

  return exports.map(data, (doc) => {
    return Object.entries(doc).reduce((prev, [key, value]) => {
      return Object.assign(prev, { [key]: (fields.indexOf(key) > -1 ? exports.guidToId(value) : value) });
    }, {});
  });
};

exports.keyPaths = (obj = {}, keys = [], path) => {
  return Object.entries(obj).reduce((prev, [key, value]) => {
    const keyPath = path ? `${path}.${key}` : key;

    if (exports.isPlainObject(value)) return exports.keyPaths(value, prev, keyPath);

    // if (Array.isArray(value)) {
    //   const arr = value.filter(v => exports.isPlainObject(v));
    //   if (arr.length) return _.flatten(arr.map(val => exports.keyPaths(val, prev, keyPath)));
    // }

    return prev.concat(keyPath);
  }, keys);
};

exports.keyPathLeafs = (obj, keys, path) => {
  return exports.keyPaths(obj, keys, path).sort().reverse().filter((leaf, i, arr) => arr.findIndex(el => el.indexOf(leaf) === 0) === i);
};

// exports.keyPaths = (obj, keys = [], path) => {
//   return Object.entries(obj).reduce((prev, [key, value]) => {
//     const keyPath = path ? `${path}.${key}` : key;
//     prev.push(keyPath);
//     if (exports.isPlainObject(value)) return exports.keyPaths(value, prev, keyPath);
//     return prev;
//   }, keys);
// };

exports.queryPaths = (model, obj) => {
  return exports.keyPaths(obj).filter(path => path.indexOf('edges.cursor') === -1).map((path) => {
    return path.replace(/edges|node/gi, '').replace(/^\.+|\.+$/g, '');
  }).filter(a => a);
};

exports.promiseChain = (promises) => {
  return promises.reduce((chain, promise) => {
    return chain.then(chainResults => promise([...chainResults]).then(promiseResult => [...chainResults, promiseResult]));
  }, Promise.resolve([]));
};

exports.promiseRetry = (fn, ms, retries = 5, cond = e => e) => {
  return fn().catch((e) => {
    if (!retries || !cond(e)) throw e;
    return exports.timeout(ms).then(() => exports.promiseRetry(fn, ms, --retries, cond));
  });
};

exports.proxyPromise = (promise) => {
  return new Proxy(promise, {
    get(target, prop, rec) {
      const value = Reflect.get(target, prop, rec);
      if (typeof value === 'function') return value.bind(target);
      return (...args) => promise.then(result => result[prop](...args));
    },
  });
};

exports.proxyDeep = (obj, handler, proxyMap = new WeakMap(), path = '') => {
  obj = obj || {};
  if (proxyMap.has(obj)) return proxyMap.get(obj);

  const proxy = new Proxy(Object.entries(obj).reduce((prev, [key, value]) => {
    if (Array.isArray(value)) return Object.assign(prev, { [key]: value.map(v => (exports.isPlainObject(v) ? exports.proxyDeep(v, handler, proxyMap, path) : v)) });
    if (exports.isPlainObject(value)) return Object.assign(prev, { [key]: exports.proxyDeep(value, handler, proxyMap, path) });
    return Object.assign(prev, { [key]: value });
  }, {}), handler);

  const finalProxy = Object.defineProperty(proxy, 'toObject', {
    get() {
      return (getMap = new WeakMap()) => {
        if (getMap.has(this)) return getMap.get(this);

        const plainObject = Object.entries(this).reduce((prev, [key, value]) => {
          if (Array.isArray(value)) return Object.assign(prev, { [key]: value.map(v => (v.toObject ? v.toObject(getMap) : v)) });
          return Object.assign(prev, { [key]: _.get(value, 'toObject') ? value.toObject(getMap) : value });
        }, {});

        getMap.set(this, plainObject);

        return plainObject;
      };
    },
  });

  proxyMap.set(obj, finalProxy);

  return finalProxy;
};
