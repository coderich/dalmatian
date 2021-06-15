const Boom = require('../core/Boom');
const { unravelObject } = require('../service/app.service');

module.exports = class Query {
  constructor(props = {}) {
    this.props = {};
    this.timers = {};
    this.props.joins = this.props.joins || [];
    this.props.match = this.props.match || {};
    this.props.options = this.props.options || {};
    this.isClassicPaging = false;
    this.isCursorPaging = false;
    this.merge(props);
  }

  propCheck(prop, ...checks) {
    checks.forEach((check) => {
      if (this.props[check]) throw Boom.badRequest(`Cannot use "${prop}" while using "${check}"`);
    });
  }

  id(id) {
    this.propCheck('id', 'where', 'native', 'sort', 'skip', 'limit', 'before', 'after', 'first', 'last');
    this.props.id = id;
    return this.match({ id });
  }

  where(where) {
    this.propCheck('where', 'id', 'native');
    this.props.where = unravelObject(where);
    return this.match(where);
  }

  search(search) {
    this.propCheck('search', 'id');
    this.props.search = search;
    return this;
  }

  native(native) {
    this.propCheck('native', 'id', 'where');
    this.props.native = native;
    return this.match(native);
  }

  match(match) {
    this.props.match = unravelObject(match);
    return this;
  }

  select(select) {
    this.props.select = unravelObject(select);
    return this;
  }

  $select(select) {
    this.props.$select = select;
    return this;
  }

  fields(fields) {
    this.props.select = fields;
    return this;
  }

  joins(...joins) {
    this.props.joins.push(...joins);
    return this;
  }

  sort(sort) {
    this.propCheck('sort', 'id');
    this.props.sort = unravelObject(sort);
    return this;
  }

  $sort(sort) {
    this.props.$sort = sort;
    return this;
  }

  sortBy(sort) {
    return this.sort(sort);
  }

  skip(skip) {
    this.propCheck('skip', 'id');
    if (this.isCursorPaging) throw Boom.badRequest('Cannot use "skip" while using Cursor-Style Pagination');
    this.isClassicPaging = true;
    this.props.skip = skip;
    return this;
  }

  limit(limit) {
    this.propCheck('limit', 'id');
    if (this.isCursorPaging) throw Boom.badRequest('Cannot use "limit" while using Cursor-Style Pagination');
    this.isClassicPaging = true;
    this.props.limit = limit;
    return this;
  }

  first(first) {
    this.propCheck('first', 'id', 'last');
    if (this.isClassicPaging) throw Boom.badRequest('Cannot use "first" while using Classic-Style Pagination');
    this.isCursorPaging = true;
    this.props.first = first + 2; // Adding 2 for pagination meta info (hasNext hasPrev)
    return this;
  }

  last(last) {
    this.propCheck('last', 'id', 'first');
    if (this.isClassicPaging) throw Boom.badRequest('Cannot use "last" while using Classic-Style Pagination');
    this.isCursorPaging = true;
    this.props.last = last + 2; // Adding 2 for pagination meta info (hasNext hasPrev)
    return this;
  }

  before(before) {
    this.propCheck('before', 'id');
    if (this.isClassicPaging) throw Boom.badRequest('Cannot use "before" while using Classic-Style Pagination');
    this.isCursorPaging = true;
    this.props.before = before;
    return this;
  }

  after(after) {
    this.propCheck('after', 'id');
    if (this.isClassicPaging) throw Boom.badRequest('Cannot use "after" while using Classic-Style Pagination');
    this.isCursorPaging = true;
    this.props.after = after;
    return this;
  }

  options(options) {
    this.props.options = options;
    return this;
  }

  meta(meta) {
    this.props.meta = meta;
    return this;
  }

  flags(flags) {
    this.props.flags = flags;
    return this;
  }

  root(root) {
    this.props.root = root;
    return this;
  }

  /**
   * Merge unknown attributes into props; hence the check to do a noop
   */
  merge(query) {
    Object.entries(query).forEach(([key, value]) => { if (this[key]) this[key](value); }); // Call method only if exists
    return this;
  }

  resolver(resolver) {
    this.props.resolver = resolver;
    return this;
  }

  model(model) {
    this.props.model = model;
    return this;
  }

  transaction(transaction) {
    this.props.transaction = transaction;
    return this;
  }

  cmd(cmd) {
    this.props.cmd = cmd;
    return this;
  }

  method(method) {
    this.props.method = method;

    switch (method) {
      case 'createOne': case 'createMany': {
        this.props.crud = 'create';
        break;
      }
      case 'updateOne': case 'updateMany': {
        this.props.crud = 'update';
        break;
      }
      case 'deleteOne': case 'deleteMay': case 'removeOne': case 'removeMany': {
        this.props.crud = 'delete';
        break;
      }
      default: {
        this.props.crud = 'read';
        break;
      }
    }

    return this;
  }

  crud(crud) {
    this.props.crud = crud;
    return this;
  }

  input(input = {}) { // Allows .save(/* empty */);
    this.props.input = input;
    return this;
  }

  $input(input) {
    this.props.$input = input;
    return this;
  }

  doc(doc) {
    this.props.doc = doc;
    return this;
  }

  merged(merged) {
    this.props.merged = merged;
    return this;
  }

  $doc($doc) {
    this.props.$doc = $doc;
    return this;
  }

  args(args) {
    this.props.args = args;
    return this;
  }

  clone() {
    return new Query({ ...this.props });
  }

  toDriver() {
    const { model } = this.props;
    const isSorted = Boolean(Object.keys(this.props.$sort || {}).length);

    return {
      isNative: Boolean(this.props.native),
      model: model.getKey(),
      schema: Query.getSchema(model),
      method: this.props.method,
      select: this.props.$select,
      joins: this.props.joins,
      where: this.props.match,
      search: this.props.search,
      sort: this.props.$sort,
      skip: this.props.skip,
      limit: this.props.limit,
      first: isSorted ? this.props.first : undefined,
      after: isSorted && this.props.after ? model.normalize(this, JSON.parse(Buffer.from(this.props.after, 'base64').toString('ascii')), 'serialize') : undefined,
      last: isSorted ? this.props.last : undefined,
      before: isSorted && this.props.before ? model.normalize(this, JSON.parse(Buffer.from(this.props.before, 'base64').toString('ascii')), 'serialize') : undefined,
      options: this.props.options,
      input: this.props.$input,
      flags: this.props.flags,
      $doc: this.props.$doc,
      doc: this.props.doc,
    };
  }

  toObject() {
    return this.props;
  }

  getCacheKey() {
    return {
      model: `${this.props.model}`,
      method: this.props.method,
      where: this.props.match,
      search: this.props.search,
      sort: this.props.sort,
      skip: this.props.skip,
      limit: this.props.limit,
      before: this.props.before,
      after: this.props.after,
      first: this.props.first,
      last: this.props.last,
      options: this.props.options,
    };
  }

  static getSchema(model, name = false) {
    return model.getSelectFields().reduce((prev, field) => {
      const key = name ? field.getName() : field.getKey();
      // const modelRef = field.getModelRef();
      // const isEmbedded = field.isEmbedded();

      return Object.assign(prev, {
        [key]: {
          field,
          alias: name ? field.getKey() : field.getName(),
          type: field.getDataType(),
          isArray: field.isArray(),
          // schema: isEmbedded ? Query.getSchema(modelRef, name) : null,
        },
      });
    }, {});
  }
};
