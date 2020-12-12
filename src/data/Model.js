const Field = require('./Field');
const ResultSet = require('./ResultSet');
const Model = require('../graphql/ast/Model');
const RuleService = require('../service/rule.service');
const { map, ensureArray, stripObjectNulls } = require('../service/app.service');

const assignValue = (field, doc, prop, value) => {
  if (value == null) return value; // Do not hold on to DataResolver

  return Promise.resolve(value).then(($value) => {
    return field.resolve($value).then(($$value) => {
      Object.defineProperty(doc, prop, { value: $$value, writable: true });
      return $$value;
    });
  });
};

module.exports = class extends Model {
  constructor(schema, model, driver) {
    super(schema, model.getAST());
    this.driver = driver;
    this.fields = super.getFields().map(field => new Field(this, field));
    this.namedQueries = {};
  }

  // CRUD
  get(where, options) {
    this.normalizeOptions(options);
    return new ResultSet(this, this.driver.dao.get(this, this.normalize(where), options));
  }

  find(where = {}, options) {
    this.normalizeOptions(options);
    return new ResultSet(this, this.driver.dao.find(this, this.normalize(where), options));
  }

  count(where = {}, options) {
    this.normalizeOptions(options);
    return this.driver.dao.count(this, this.normalize(where), options);
  }

  create(data, options) {
    this.normalizeOptions(options);
    return new ResultSet(this, this.driver.dao.create(this, this.serialize(data), options));
  }

  update(id, data, doc, options) {
    this.normalizeOptions(options);
    return new ResultSet(this, this.driver.dao.update(this, this.idValue(id), this.serialize(data), this.serialize(doc), options));
  }

  replace(id, data, doc, options) {
    this.normalizeOptions(options);
    return new ResultSet(this, this.driver.dao.replace(this, this.idValue(id), this.serialize(data), this.serialize(doc), options));
  }

  delete(id, doc, options) {
    this.normalizeOptions(options);
    return new ResultSet(this, this.driver.dao.delete(this, this.idValue(id), doc, options));
  }

  native(method, ...args) {
    switch (method) {
      case 'count': return this.driver.dao.native(this, method, ...args);
      default: return new ResultSet(this, this.driver.dao.native(this, method, ...args));
    }
  }

  raw() {
    return this.driver.dao.raw(this);
  }

  drop() {
    return this.driver.dao.dropModel(this);
  }

  //

  idValue(id) {
    return this.driver.idValue(id);
  }

  idKey() {
    return this.getDirectiveArg('model', 'id', this.driver.idKey());
  }

  normalizeOptions(options) {
    if (!options.selectAll) options.fields = this.getPersistableFields().map(f => f.getKey());
  }

  getDriver() {
    return this.driver.dao;
  }

  // Temporary until you can rely fully on Query for resolver
  getResolver() { return this.resolver; }

  setResolver(resolver) { this.resolver = resolver; }
  //

  createNamedQuery(name, fn) {
    this.namedQueries[name] = fn;
  }

  getNamedQueries(name) {
    return this.namedQueries;
  }

  referentialIntegrity(refs) {
    if (refs) this.referentials = refs;
    return this.referentials;
  }

  async appendCreateFields(input, embed = false) {
    const idKey = this.idKey();

    if (embed && idKey && !input[idKey]) input[idKey] = this.idValue();
    if (!input.createdAt) input.createdAt = new Date();
    input.updatedAt = new Date();

    // Generate embedded default values
    await Promise.all(this.getEmbeddedFields().filter(field => field.hasGQLScope('c')).map((field) => {
      if (!input[field]) return Promise.resolve();
      return Promise.all(ensureArray(map(input[field], v => field.getModelRef().appendCreateFields(v, true))));
    }));

    return input;
  }

  async appendDefaultValues(input) {
    input = await this.resolveDefaultValues(stripObjectNulls(input));

    // Generate embedded default values
    await Promise.all(this.getEmbeddedFields().filter(field => field.hasGQLScope('c')).map((field) => {
      if (!input[field]) return Promise.resolve();
      return Promise.all(ensureArray(map(input[field], v => field.getModelRef().appendDefaultValues(v))));
    }));

    return input;
  }

  async appendUpdateFields(input) {
    input.updatedAt = new Date();
    input = this.removeBoundKeys(input);
    return input;
  }

  getDefaultValues(data = {}) {
    if (data === null) return null; // Explicitely being told to null out?

    const defaultedFields = this.getDefaultedFields();
    const fieldNames = [...new Set(Object.keys(ensureArray(data)[0]).concat(defaultedFields.map(field => `${field}`)))];

    return fieldNames.reduce((prev, fieldName) => {
      const field = this.getFieldByName(fieldName);
      if (fieldName !== '_id' && !field) return prev; // There can still be nonsense passed in via the DAO
      let value = data[fieldName];
      if (value === undefined) value = field.getDefaultValue();
      if (fieldName !== '_id' && field.isEmbedded()) value = Array.isArray(value) ? value.map(v => field.getModelRef().getDefaultValues(v)) : field.getModelRef().getDefaultValues(value);
      return Object.assign(prev, { [fieldName]: value });
    }, {});
  }

  resolveDefaultValues(data) {
    return this.resolveBoundValues(this.getDefaultValues(data));
  }

  resolveBoundValues(data) {
    const boundFields = this.getBoundValueFields();

    return map(data, obj => Promise.all(boundFields.map((boundField) => {
      return boundField.resolveBoundValue(obj[boundField]);
    })).then((values) => {
      values.forEach((value, i) => { obj[boundFields[i]] = value; }); // Assign new value
      return data;
    }));
  }

  removeBoundKeys(data) {
    return map(data, obj => Object.entries(obj).reduce((prev, [key, value]) => {
      const field = this.getFieldByName(key);
      if (field && field.hasBoundValue()) return prev;
      return Object.assign(prev, { [key]: value });
    }, {}));
  }

  normalize(data, mapper) {
    return map(data, (obj) => {
      if (obj == null) return obj;

      return Object.entries(obj).reduce((prev, [key, value]) => {
        const field = this.getFieldByName(key) || this.getFieldByKey(key);
        if (!field || !field.isPersistable()) return prev;
        if (value === undefined) value = obj[field.getKey()];
        value = field.normalize(value, mapper);
        if (field.isEmbedded()) value = field.getModelRef().normalize(value, mapper);
        return Object.assign(prev, { [field.getKey()]: value });
      }, {}); // Strip away all props not in schema
    });
  }

  serialize(data, mapper) {
    return map(data, (obj) => {
      if (obj == null) return obj;

      return Object.entries(obj).reduce((prev, [key, value]) => {
        const field = this.getFieldByName(key) || this.getFieldByKey(key);
        if (!field || !field.isPersistable()) return prev;
        if (value === undefined) value = obj[field.getKey()];
        value = field.serialize(value, mapper);
        if (!field.getSerialize() && field.isEmbedded()) value = field.getModelRef().serialize(value, mapper);
        return Object.assign(prev, { [field.getKey()]: value });
      }, {}); // Strip away all props not in schema
    });
  }

  deserialize(data, mapper) {
    // You're going to get a mixed bag of DB keys and Field keys here
    const dataWithValues = map(data, (obj) => {
      if (obj == null) return obj;

      return Object.entries(obj).reduce((prev, [key, value]) => {
        const field = this.getFieldByKey(key) || this.getFieldByName(key);
        if (!field) return prev; // Strip completely unknown fields
        if (value == null) value = obj[field.getKey()]; // This is intended to level out what the value should be
        value = field.deserialize(value, mapper);
        if (!field.getDeserialize() && field.isEmbedded()) value = field.getModelRef().deserialize(value, mapper);
        return Object.assign(prev, { [field]: value });
      }, obj); // May have $hydrated values you want to keep
    });

    // Finally, remove unwanted database keys
    map(dataWithValues, (obj) => {
      if (obj == null) return obj;

      return Object.keys(obj).forEach((key) => {
        if (key !== '_id' && !this.getFieldByName(key)) delete obj[key];
      });
    });

    return dataWithValues;
  }

  transform(data, mapper) {
    return map(data, (obj) => {
      if (obj == null) return obj;

      return Object.entries(obj).reduce((prev, [key, value]) => {
        const field = this.getField(key);
        if (!field) return prev;
        return Object.assign(prev, { [field]: field.transform(value, mapper) });
      }, obj); // Keep $hydrated props
    });
  }

  validate(data, mapper) {
    // Validate does an explicit transform first
    const transformed = this.transform(data, mapper);

    // Enforce the rules
    return Promise.all(this.getFields().map((field) => {
      return Promise.all(ensureArray(map(transformed, (obj) => {
        if (obj == null) return Promise.resolve();
        return field.validate(obj[field.getName()], mapper);
      })));
    })).then(() => transformed);
  }

  validateData(data, oldData, op) {
    const required = (op === 'create' ? (f, v) => v == null : (f, v) => Object.prototype.hasOwnProperty.call(data, f.getName()) && v == null);
    const immutable = (f, v) => RuleService.immutable(v, oldData, op, `${f.getModel()}.${f.getName()}`);
    const selfless = (f, v) => RuleService.selfless(v, oldData, op, `${f.getModel()}.${f.getName()}`);
    return this.validate(data, { required, immutable, selfless });
  }

  resolve(doc, prop, resolver, query) {
    // Value check if already resolved
    const value = doc[prop];
    if (value !== undefined) return value;
    if (typeof prop === 'symbol') return value;

    // // Count resolver
    // const countField = this.getCountField(prop);
    // if (countField) return assignValue(f, doc, prop, countField.count(resolver, doc));

    // Hydration check
    const [, $prop] = prop.split('$');
    if (!$prop) return value; // Nothing to hydrate

    // Field check
    const field = this.getField($prop);
    if (!field) return value; // Unknown field

    // Set $value to the original unhydrated value
    const $value = doc[$prop];

    if (field.isScalar() || field.isEmbedded()) return assignValue(field, doc, prop, $value); // No hydration needed; apply $value

    // Model resolver
    const fieldModel = field.getModelRef();

    if (field.isArray()) {
      if (field.isVirtual()) {
        const where = { [field.getVirtualField()]: doc.id };
        return assignValue(field, doc, prop, resolver.match(fieldModel).query({ where }).many({ find: true }));
      }

      // Not a "required" query + strip out nulls
      return assignValue(field, doc, prop, Promise.all(ensureArray($value).map(id => resolver.match(fieldModel).id(id).one())).then(results => results.filter(r => r != null)));
    }

    if (field.isVirtual()) {
      const where = { [field.getVirtualField()]: doc.id };
      return assignValue(field, doc, prop, resolver.match(fieldModel).query({ where }).one({ find: true }));
    }

    return assignValue(field, doc, prop, resolver.match(fieldModel).id($value).one({ required: field.isRequired() }));
  }
};
