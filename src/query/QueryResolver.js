const { isEmpty } = require('lodash');
const Boom = require('../core/Boom');
const QueryService = require('./QueryService');
const QueryResult = require('./QueryResult');
const { ucFirst, unravelObject, mergeDeep, removeUndefinedDeep } = require('../service/app.service');

module.exports = class QueryResolver {
  constructor(query) {
    this.query = query;
    this.resolver = query.resolver();
  }

  get(query) {
    const { model, flags } = query.toObject();

    return this.resolver.resolve(query).then((doc) => {
      if (flags.required && doc == null) throw Boom.notFound(`${model} Not Found`);
      return doc;
    });
  }

  find(query) {
    const { model, flags } = query.toObject();

    return this.resolver.resolve(query).then((docs) => {
      if (flags.required && isEmpty(docs)) throw Boom.notFound(`${model} Not Found`);
      return docs;
    });
  }

  count(query) {
    return this.resolver.resolve(query);
  }

  async create(query) {
    const { model, input } = query.toObject();
    await model.validateData(input, {}, 'create');
    return this.resolver.resolve(query).then(id => Object.assign(input, { id }));
  }

  update(query) {
    const { model, input, flags } = query.toObject();
    const clone = query.clone().method('get').flags(Object.assign({}, flags, { required: true }));

    return this.resolver.resolve(clone).then(async (doc) => {
      if (doc == null) throw Boom.notFound(`${model} Not Found`);
      await model.validateData(input, doc, 'update');
      const $doc = model.serialize(mergeDeep(doc, removeUndefinedDeep(input)));
      return this.resolver.resolve(query.doc(doc).$doc($doc)).then(() => $doc);
    });
  }

  delete(query) {
    const { model, flags } = query.toObject();
    const clone = query.clone().method('get').flags(Object.assign({}, flags, { required: true }));

    return this.resolver.resolve(clone).then((doc) => {
      if (doc == null) throw Boom.notFound(`${model} Not Found`);
      return this.resolver.resolve(query).then(() => doc);
    });
  }

  async resolve() {
    const clone = this.query.clone();
    const { model, crud, method, flags, isNative } = this.query.toObject();
    const { required, debug } = flags;
    const fields = model.getSelectFields();
    const fieldNameToKeyMap = fields.reduce((prev, field) => Object.assign(prev, { [field.getName()]: field.getKey() }), {});
    // const normalize = data => Object.entries(data).reduce((prev, [name, value]) => Object.assign(prev, { [fieldNameToKeyMap[name]]: value }), {});

    // Select fields
    const $select = unravelObject(this.query.select() ? Object.keys(this.query.select()).map(n => fieldNameToKeyMap[n]) : fields.map(f => f.getKey()));
    clone.select($select);

    // Where clause
    if (!isNative) {
      const where = await model.resolveBoundValues(unravelObject(this.query.match()));
      let $where = await QueryService.resolveQueryWhereClause(this.query.match(where));
      $where = model.normalize($where);
      $where = removeUndefinedDeep($where);
      clone.match($where);
    }

    // Input data
    if (crud === 'create' || crud === 'update') {
      let $input = unravelObject(this.query.input());
      if (crud === 'create') $input = await model.appendDefaultValues($input);
      $input = await model[`append${ucFirst(crud)}Fields`]($input);
      $input = model.normalize($input);
      $input = model.serialize($input); // This seems to be needed to accept Objects and convert them to ids; however this also makes .save(<empty>) throw an error and I think you should be able to save empty
      // $input = removeUndefinedDeep($input);
      clone.input($input);
    }

    return this[method](clone).then((data) => {
      if (required && (data == null || isEmpty(data))) throw Boom.notFound(`${model} Not Found`);
      if (debug) console.log('got result', data);
      if (data == null) return null;
      return typeof data === 'object' ? new QueryResult(this.query, data) : data;
    });
  }
};
