const Boom = require('../core/Boom');
const { mergeDeep, removeUndefinedDeep } = require('../service/app.service');
const { createSystemEvent } = require('../service/event.service');
const { resolveModelWhereClause, resolveReferentialIntegrity, sortData, filterDataByCounts, paginateResults, spliceEmbeddedArray } = require('../service/data.service');

module.exports = class QueryWorker {
  constructor(resolver) {
    this.resolver = resolver;

    // Convenience methods
    this.push = (query, key, values) => this.splice(query, key, null, values);
    this.pull = (query, key, values) => this.splice(query, key, values);
  }

  query(query) {
    return this.find(query);
  }

  async get(query, required) {
    const { resolver } = this;
    const [model, id, options] = [query.getModel(), query.getId(), query.getOptions()];

    // Construct where clause
    const where = { id: model.idValue(id) };
    const $where = await model.resolveBoundValues(where);
    const resolvedWhere = await resolveModelWhereClause(resolver, model, $where);

    return createSystemEvent('Query', { method: 'get', model, resolver, query }, async () => {
      const doc = await model.get(resolvedWhere, options).hydrate(resolver, query);
      if (!doc && required) throw Boom.notFound(`${model} Not Found`);
      if (doc == null) return null;
      return doc;
    });
  }

  find(query) {
    const { resolver } = this;
    const [model, where, limit, countFields, sortFields, options] = [query.getModel(), query.getWhere(), query.getLimit(), query.getCountFields(), query.getSortFields(), query.getOptions()];

    let hydratedResults;
    return createSystemEvent('Query', { method: 'find', model, resolver, query }, async () => {
      if (query.isNative()) {
        hydratedResults = await model.native('find', query.getNative(), options).hydrate(resolver, query);
      } else {
        const $where = await model.resolveBoundValues(where);
        const resolvedWhere = await resolveModelWhereClause(resolver, model, $where, options);
        hydratedResults = await model.find(resolvedWhere, options).hydrate(resolver, query);
      }
      const filteredData = filterDataByCounts(resolver, model, hydratedResults, countFields);
      const sortedResults = sortData(filteredData, sortFields);
      const limitedResults = sortedResults.slice(0, limit > 0 ? limit : undefined);
      return paginateResults(limitedResults, query.getPagination());
    });
  }

  count(query) {
    const { resolver } = this;
    const [model, where, countFields, countPaths, options] = [query.getModel(), query.getWhere(), query.getCountFields(), query.getCountPaths(), query.getOptions()];

    return createSystemEvent('Query', { method: 'count', model, resolver, query }, async () => {
      if (query.isNative()) return model.native('count', query.getNative(), options);

      const $where = await model.resolveBoundValues(where);
      const resolvedWhere = await resolveModelWhereClause(resolver, model, $where);

      if (countPaths.length) {
        const results = await resolver.match(model).where(resolvedWhere).select(countFields).options(options).many();
        const filteredData = filterDataByCounts(resolver, model, results, countFields);
        return filteredData.length;
      }

      return model.count(resolvedWhere, options);
    });
  }

  async create(query, input) {
    input = input || {};
    const { resolver } = this;
    const [model, options] = [query.getModel(), query.getOptions()];

    // Set default values for create
    input = await model.appendDefaultValues(input);

    return createSystemEvent('Mutation', { method: 'create', model, resolver, query, input }, async () => {
      input = await model.appendCreateFields(input); // Now create fields (give a change to alter input)
      await model.validateData(input, {}, 'create');
      return model.create(input, options).hydrate(resolver, query);
    });
  }

  async update(query, input) {
    input = input || {};
    const { resolver } = this;
    const [id, model, options] = [query.getId(), query.getModel(), query.getOptions()];

    const doc = await resolver.match(model).id(id).options(options).one({ required: true });

    // //
    // const where = { id: model.idValue(id) };
    // const $where = await model.resolveBoundValues(where);
    // const resolvedWhere = await resolveModelWhereClause(resolver, model, $where);
    // const doc = await model.get(resolvedWhere, Object.assign({}, options, { selectAll: true })).promise;

    // Set default values for update
    const merged = mergeDeep(doc, removeUndefinedDeep(input));

    return createSystemEvent('Mutation', { method: 'update', model, resolver, query, input, doc, merged }, async () => {
      input = await model.appendUpdateFields(input);
      await model.validateData(input, doc, 'update');
      return model.update(id, input, mergeDeep(doc, removeUndefinedDeep(input)), options).hydrate(resolver, query);
    });
  }

  async splice(query, key, from, to) {
    const { resolver } = this;
    const [id, model, options] = [query.getId(), query.getModel(), query.getOptions()];
    const doc = await resolver.match(model).id(id).options(options).one({ required: true });
    const data = await spliceEmbeddedArray(query, doc, key, from, to);
    const merged = mergeDeep(doc, removeUndefinedDeep(data));

    return createSystemEvent('Mutation', { method: 'splice', model, resolver, query, input: data, doc, merged }, async () => {
      await model.validateData(data, doc, 'update');
      return model.replace(id, data, mergeDeep(doc, removeUndefinedDeep(data)), options).hydrate(resolver, query);
    });
  }

  async delete(query, txn) {
    const { resolver } = this;
    const [id, model, options] = [query.getId(), query.getModel(), query.getOptions()];
    const doc = await resolver.match(model).id(id).options(options).one({ required: true });

    return createSystemEvent('Mutation', { method: 'delete', model, resolver, query, doc }, () => {
      return resolveReferentialIntegrity(resolver, model, query, txn).then(async () => {
        return model.delete(id, doc, options).hydrate(resolver, query);
      });
    });
  }
};
