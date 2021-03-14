const { clone } = require('lodash');

let count = 0;

module.exports = class Query {
  constructor(props) {
    this.timers = {};
    this.queryId = `query${++count}`;
    this.props = props || {};
    this.props.match = this.props.match || {};
    this.props.options = this.props.options || {};
  }

  time(label = 'default') {
    this.timers[label] = { start: new Date().getTime() };
    return this;
  }

  timeEnd(label = 'default') {
    this.timers[label].end = new Date().getTime();
    return this;
  }

  timeReport() {
    const report = Object.entries(this.timers).reduce((prev, [key, value]) => {
      return Object.assign(prev, { [key]: value.end - value.start });
    }, {});

    const toDriver = this.toDriver();

    console.log(JSON.stringify({
      [this.queryId]: {
        details: {
          model: toDriver.model,
          method: toDriver.method,
          where: toDriver.where,
          input: toDriver.input,
          flags: toDriver.flags,
        },
        report,
      },
    }, null, 2));
  }

  id(id) {
    if (this.props.where || this.props.native || this.props.sort || this.props.skip || this.props.limit || this.props.before || this.props.after || this.props.first || this.props.last) throw new Error('Cannot mix id() with where(), native(), sort(), skip(), limit(), before(), after(), first(), or last()');
    this.props.id = id;
    return this.match({ id });
  }

  where(where) {
    if (this.props.id || this.props.native) throw new Error('Cannot mix where() with id() or native()');
    this.props.where = where;
    return this.match(where);
  }

  native(native) {
    if (this.props.id || this.props.where) throw new Error('Cannot mix native() with id() or where()');
    this.props.native = native;
    return this.match(native);
  }

  match(match) {
    this.props.match = match;
    return this;
  }

  select(select) {
    this.props.select = select;
    return this;
  }

  fields(fields) {
    this.props.select = fields;
    return this;
  }

  sort(sort) {
    if (this.props.id) throw new Error('Cannot mix sort() with id()');
    this.props.sort = sort;
    return this;
  }

  skip(skip) {
    if (this.props.id) throw new Error('Cannot mix skip() with id()');
    this.props.skip = skip;
    return this;
  }

  limit(limit) {
    if (this.props.id) throw new Error('Cannot mix limit() with id()');
    this.props.limit = limit;
    return this;
  }

  before(before) {
    if (this.props.id) throw new Error('Cannot mix before() with id()');
    this.props.before = before;
    return this;
  }

  after(after) {
    if (this.props.id) throw new Error('Cannot mix after() with id()');
    this.props.after = after;
    return this;
  }

  first(first) {
    if (this.props.id || this.props.last) throw new Error('Cannot mix first() with id() or last()');
    this.props.first = first;
    return this;
  }

  last(last) {
    if (this.props.id || this.props.first) throw new Error('Cannot mix last() with id() or first()');
    this.props.last = last;
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

  merge({ fields, select = fields, where }) {
    if (select) this.props.select = select;
    if (where) Object.assign(this.props.match, where);
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

  input(input) {
    this.props.input = input;
    return this;
  }

  doc(doc) {
    this.props.doc = doc;
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
    return new Query(clone({ ...this.props }));
  }

  toDriver() {
    return {
      isNative: Boolean(this.props.native),
      model: this.props.model.getKey(),
      schema: Query.getSchema(this.props.model),
      method: this.props.method,
      select: this.props.select,
      where: this.props.match,
      sort: this.props.sort,
      skip: this.props.skip,
      limit: this.props.limit,
      before: this.props.before,
      after: this.props.after,
      first: this.props.first,
      last: this.props.last,
      options: this.props.options,
      input: this.props.input,
      flags: this.props.flags,
      $doc: this.props.$doc,
      doc: this.props.doc,
    };
  }

  toObject() {
    return {
      ...this.props,
      isNative: Boolean(this.props.native),
      schema: Query.getSchema(this.props.model),
    };
  }

  getCacheKey() {
    return {
      model: `${this.props.model}`,
      method: this.props.method,
      where: this.props.match,
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

  static getSchema(model) {
    return model.getSelectFields().reduce((prev, field) => {
      const key = field.getKey();
      const modelRef = field.getModelRef();
      const isEmbedded = field.isEmbedded();

      return Object.assign(prev, {
        [key]: {
          name: field.getName(),
          type: field.getDataType(),
          schema: isEmbedded ? Query.getSchema(modelRef) : null,
        },
      });
    }, {});
  }
};
