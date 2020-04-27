const { map, serialize, castCmp } = require('../service/app.service');

const instances = {};

const jsStringMethods = [
  'charAt', 'charCodeAt', 'codePointAt', 'concat', 'indexOf', 'lastIndexOf', 'localeCompare',
  'normalize', 'padEnd', 'padStart', 'repeat', 'replace', 'search', 'slice', 'split', 'substr', 'substring',
  'toLocaleLowerCase', 'toLocaleUpperCase', 'toLowerCase', 'toString', 'toUpperCase', 'trim', 'trimEnd', 'trimStart', 'raw',
];

class Transformer {
  constructor(thunk, ignoreNull = true) {
    return Object.defineProperty((field, val, cmp = (f, v) => thunk(f, v)) => {
      if (ignoreNull && val == null) return val;
      if (!ignoreNull) return cmp(field, val);
      return map(val, v => cmp(field, v));
    }, 'type', { value: 'transformer' });
  }

  static factory(name, thunk, ignoreNull = true, descriptor = {}) {
    return Object.defineProperty(Transformer, name, {
      value: (...args) => Object.defineProperty(new Transformer(thunk(...args), ignoreNull), 'method', { value: name }),
      ...descriptor,
    })[name];
  }

  static extend(name, instance) {
    const invalidArg = () => { throw new Error('Invalid argument; expected Transformer factory instance'); };
    const { method = invalidArg(), type = invalidArg() } = instance;
    if (type !== 'transformer' || !Transformer[method]) invalidArg();
    return (instances[name] = instance);
  }

  static getInstances() {
    const defaultTransformers = Object.entries(Transformer).map(([name, method]) => ({ name, instance: method() }));
    const customTransformers = Object.entries(instances).map(([name, instance]) => ({ name, instance }));
    const transformers = defaultTransformers.concat(customTransformers);
    return transformers.reduce((prev, { name, instance }) => Object.assign(prev, { [name]: instance }), {});
  }
}

// Factory methods
const enumerables = ['toLowerCase', 'toUpperCase', 'trim', 'trimEnd', 'trimStart', 'toString'];
jsStringMethods.forEach(name => Transformer.factory(name, (...args) => (f, v) => String(v)[name](...args), true, { enumerable: enumerables.indexOf(name) > -1 }));
Transformer.factory('toId', () => (f, v) => v, true, { writable: true });
Transformer.factory('toTitleCase', () => (f, v) => v.replace(/\w\S*/g, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()), true, { enumerable: true });
Transformer.factory('toLocaleTitleCase', (...args) => (f, v) => v.replace(/\w\S*/g, w => w.charAt(0).toLocaleUpperCase(...args) + w.slice(1).toLocaleLowerCase()));
Transformer.factory('toSentenceCase', () => (f, v) => v.charAt(0).toUpperCase() + v.slice(1), true, { enumerable: true });
Transformer.factory('toLocaleSentenceCase', (...args) => (f, v) => v.charAt(0).toLocaleUpperCase(...args) + v.slice(1));
Transformer.factory('dedupe', () => (f, a) => [...new Set(a.map(v => `${v}`))].map(v => a.find(b => `${b}` === v)), false, { enumerable: true });
Transformer.factory('timestamp', () => (f, v) => Date.now(), true, { enumerable: true });
Transformer.factory('cast', type => (f, v) => castCmp(type, v));
Transformer.factory('serialize', () => (f, v) => serialize(f, v));

module.exports = Transformer;
