const { get, set } = require('lodash');
const GraphqlFields = require('graphql-fields');
const Boom = require('../core/Boom');
const Query = require('../query/Query');
const { createSystemEvent } = require('./event.service');
const { validateModelData } = require('./data.service');
const { guidToId, unrollGuid, ucFirst, getDeep, objectContaining } = require('./app.service');

const findParentField = (name, embed, model) => {
  const schema = model.getSchema();
  const fieldName = ucFirst(embed.isArray() ? embed.getName().replace(/s$/, '') : embed.getName());
  const parentModelName = name.substr(0, name.lastIndexOf(fieldName));
  const parentModel = schema.getModel(parentModelName);
  const field = model.getFields().find(f => f.getType() === parentModelName) || parentModel.getFields().find(f => f.getType() === model.getName());
  if (!field) throw Boom.badData(`Unable to locate parent field: '${model.getName()} -> ${parentModelName}'`);
  return field;
};

const resolveQuery = (method, name, resolver, model, embeds = []) => {
  const [base] = embeds;
  const curr = embeds[embeds.length - 1];
  const fieldPath = embeds.map(field => field.getName()).join('.');

  return async (root, args, context, info) => {
    const { autograph } = context;

    if (fieldPath.length) {
      switch (method) {
        case 'get': {
          // Readjust the where clause
          const where = get(args, 'query.where', {});
          set(where, `${fieldPath}.id`, args.id);
          set(args, 'query.where', where);

          return resolver.query(context, base.getModel(), args, info).then(([result]) => {
            const arr = getDeep(result, fieldPath, []);
            return arr.find(el => `${el.id}` === `${args.id}`);
          });
        }
        case 'find': {
          // Readjust the where clause
          const where = get(args, 'query.where', {});
          const $where = set({}, `${fieldPath}`, where);
          set(args, 'query.where', $where);

          return resolver.query(context, base.getModel(), args, info).then((results) => {
            const arr = results.map(result => getDeep(result, fieldPath, [])).flat();
            return arr.filter(el => objectContaining(el, where));
          });
        }
        case 'count': {
          // Readjust the where clause
          const where = get(args, 'where', {});
          const $where = set({}, `${fieldPath}`, where);
          set(args, 'query.where', $where);

          return resolver.query(context, base.getModel(), args, info).then((results) => {
            const arr = results.map(result => getDeep(result, fieldPath, [])).flat();
            return arr.length;
          });
        }
        case 'create': {
          const field = findParentField(name, curr, model);
          const path = fieldPath.split('.').slice(0, -1).concat('id').join('.');
          const input = unrollGuid(autograph, model, args.input);
          const id = guidToId(autograph, get(input, field.getName()));

          // Get overall document
          const where = { [path]: id };
          const query = new Query(resolver, model, { where });
          const doc = await autograph.resolver.match(base.getModel()).where(where).one();
          if (!doc) throw Boom.notFound(`${base.getModel().getName()} Not Found`);

          // Get container within document
          let parent = doc;

          const container = embeds.reduce((prev, embed, i) => {
            // If further nested; must find the correct container
            if (i > 0) {
              const subField = findParentField(name, embed, model);
              prev = prev.find(el => `${el.id}` === `${args.input[subField]}`);
            }

            parent = prev;
            return getDeep(prev, embed.getName());
          }, doc);

          return model.appendDefaultValues(input).then(($input) => {
            return createSystemEvent('Mutation', { method: 'create', model, resolver, query, input: $input, parent }, async () => {
              $input = await model.appendCreateFields($input, true);
              container.push($input);
              const $update = { [base.getName()]: get(doc, base.getName()) };
              console.log(JSON.stringify($update));
              return autograph.resolver.match(base.getModel()).id(id).save($update).then(() => $input);
              // await validateModelData(model, $input, container, 'create');
              // await validateModelData(base.getModel(), $update, doc, 'update');
              // container.push($input);
              // console.log('update', base.getModel().getName(), base.getName(), id);
              // return base.getModel().update(id, { [base.getName()]: container }, doc, {}).hydrate(resolver, query).then(() => $input);
            });
          });

          // console.log(JSON.stringify(container));

          // return promiseChain(embeds.reverse().map((embed, i) => (chain) => {
          //   const data = chain.slice(-1) || doc;
          //   const query = new Query(resolver, embed.getModel());

          //   console.log(JSON.stringify(data));

          //   return spliceEmbeddedArray(query, data, embed.getName(), null, args.input).then((result) => {
          //     return getDeep(result, fieldPath).pop();
          //   });
          // })).then((results) => {
          //   return results.pop();
          // });

          // const query = new Query(resolver, base.getModel(), { where });
          // return spliceEmbeddedArray(query, doc, fieldPath, null, args.input).then((result) => {
          //   return getDeep(result, fieldPath).pop();
          // });

          // // console.log(JSON.stringify(data));

          // if (curr.isArray()) {
          //   return autograph.resolver.match(base.getModel()).id(doc.id).push(fieldPath, args.input).then((result) => {
          //     return get(result, fieldPath).pop();
          //   });
          // }

          // return null;
        }
        case 'update': {
          const modelName = model.getName();
          const fieldName = ucFirst(curr.isArray() ? curr.getName().replace(/s$/, '') : curr.getName());
          const parentModelName = modelName.substr(0, modelName.lastIndexOf(fieldName));
          const field = model.getFields().find(f => f.getType() === parentModelName);
          if (!field) throw Boom.badData(`Unable to locate parent field: '${model.getName()} -> ${parentModelName}'`);

          const id = guidToId(autograph, args.id);
          const where = { [`${fieldPath}.id`]: id };
          const doc = await autograph.resolver.match(base.getModel()).where(where).one();
          if (!doc) throw Boom.notFound(`${parentModelName} Not Found`);

          if (curr.isArray()) {
            return autograph.resolver.match(base.getModel()).id(doc.id).splice(curr.getName(), { id }, args.input).then((result) => {
              return get(result, fieldPath).find(el => `${el.id}` === `${id}`);
            });
          }

          return null;
        }
        case 'delete': {
          const modelName = model.getName();
          const fieldName = ucFirst(curr.isArray() ? curr.getName().replace(/s$/, '') : curr.getName());
          const parentModelName = modelName.substr(0, modelName.lastIndexOf(fieldName));
          const field = model.getFields().find(f => f.getType() === parentModelName);
          if (!field) throw Boom.badData(`Unable to locate parent field: '${model.getName()} -> ${parentModelName}'`);

          const id = guidToId(autograph, args.id);
          const where = { [`${fieldPath}.id`]: id };
          const doc = await autograph.resolver.match(base.getModel()).where(where).one();
          if (!doc) throw Boom.notFound(`${base.getModel()} Not Found`);

          if (curr.isArray()) {
            return autograph.resolver.match(base.getModel()).id(doc.id).pull(curr.getName(), { id }).then((result) => {
              return get(result, fieldPath).find(el => `${el.id}` === `${id}`);
            });
          }

          return null;
        }
        default: {
          return null;
        }
      }
    }

    switch (method) {
      case 'get': return resolver.get(context, model, args, true, info);
      case 'find': return resolver.query(context, model, args, info);
      case 'count': return resolver.count(context, model, args, info);
      case 'create': return resolver.create(context, model, args, { fields: GraphqlFields(info, {}, { processArguments: true }) });
      case 'update': return resolver.update(context, model, args, { fields: GraphqlFields(info, {}, { processArguments: true }) });
      case 'delete': return resolver.delete(context, model, args, { fields: GraphqlFields(info, {}, { processArguments: true }) });
      default: return null;
    }
  };
};

const makeEmbeddedAPI = (model, method, parent) => {
  let gql = '';
  const modelName = model.getName();
  const fields = model.getEmbeddedFields().filter(field => field.getModelRef().isMarkedModel());

  if (fields.length) {
    fields.forEach((field) => {
      const modelRef = field.getModelRef();
      const fieldName = ucFirst(field.isArray() ? field.getName().replace(/s$/, '') : field.getName());
      const name = `${modelName}${fieldName}`;

      switch (method) {
        case 'create': {
          gql += exports.makeCreateAPI(name, modelRef, field);
          break;
        }
        case 'read': {
          gql += exports.makeReadAPI(name, modelRef, field);
          break;
        }
        case 'update': {
          gql += exports.makeUpdateAPI(name, modelRef, field);
          break;
        }
        case 'delete': {
          gql += exports.makeDeleteAPI(name, modelRef, field);
          break;
        }
        default: {
          throw new Error(`Unknown method '${method}'`);
        }
      }
    });
  }

  return gql;
};

const makeEmbeddedResolver = (model, resolver, type, embeds = []) => {
  const obj = {};

  const parent = embeds[embeds.length - 1];
  const modelName = model.getName();
  const fields = model.getEmbeddedFields().filter(field => field.getModelRef().isMarkedModel());

  fields.forEach((field) => {
    const modelRef = field.getModelRef();
    const fieldName = ucFirst(field.isArray() ? field.getName().replace(/s$/, '') : field.getName());
    const name = `${modelName}${fieldName}`;

    switch (type) {
      case 'query': {
        Object.assign(obj, exports.makeQueryResolver(name, modelRef, resolver, embeds.concat(field)));
        break;
      }
      case 'mutation': {
        Object.assign(obj, exports.makeMutationResolver(name, modelRef, resolver, embeds.concat(field)));
        break;
      }
      default: {
        throw new Error(`Unknown type '${type}'`);
      }
    }
  });

  return obj;
};

exports.makeInputSplice = (model, embed = false) => {
  let gql = '';
  const fields = model.getArrayFields().filter(field => field.hasGQLScope('c', 'u', 'd'));

  if (fields.length) {
    gql += fields.map((field) => {
      const embedded = field.isEmbedded() ? exports.makeInputSplice(field.getModelRef(), true) : '';

      return `
        ${embedded}
        input ${model.getName()}${ucFirst(field.getName())}InputSplice {
          with: ${field.getGQLType('InputWhere', { splice: true })}
          put: ${field.getGQLType('InputUpdate', { splice: true })}
          ${embedded.length ? `splice: ${field.getModelRef().getName()}InputSplice` : ''}
        }
      `;
    }).join('\n\n');

    gql += `
      input ${model.getName()}InputSplice {
        ${fields.map(field => `${field.getName()}: ${model.getName()}${ucFirst(field.getName())}InputSplice`)}
      }
    `;
  }

  return gql;
};

// APIs
exports.makeCreateAPI = (name, model, parent) => {
  let gql = '';

  if (model.hasGQLScope('c')) {
    gql += `
      create${name}(input: ${model.getName()}InputCreate! meta: ${model.getMeta()}): ${model.getName()}!
    `;
  }

  gql += makeEmbeddedAPI(model, 'create', parent);

  return gql;
};

exports.makeReadAPI = (name, model, parent) => {
  let gql = '';

  if (model.hasGQLScope('r')) {
    gql += `
      get${name}(id: ID!): ${model.getName()}
      find${name}(first: Int after: String last: Int before: String query: ${ucFirst(model.getName())}InputQuery): Connection!
      count${name}(where: ${ucFirst(model.getName())}InputWhere): Int!
    `;
  }

  gql += makeEmbeddedAPI(model, 'read', parent);

  return gql;
};

exports.makeUpdateAPI = (name, model, parent) => {
  let gql = '';

  if (model.hasGQLScope('u')) {
    const spliceFields = model.getArrayFields().filter(field => field.hasGQLScope('c', 'u', 'd'));

    gql += `
      update${name}(
        id: ID!
        input: ${model.getName()}InputUpdate
        ${!spliceFields.length ? '' : `splice: ${model.getName()}InputSplice`}
        meta: ${model.getMeta()}
      ): ${model.getName()}!
    `;
  }

  gql += makeEmbeddedAPI(model, 'update', parent);

  return gql;
};

exports.makeDeleteAPI = (name, model, parent) => {
  let gql = '';

  if (model.hasGQLScope('d')) {
    gql += `
      delete${name}(id: ID! meta: ${model.getMeta()}): ${model.getName()}!
    `;
  }

  gql += makeEmbeddedAPI(model, 'delete', parent);

  return gql;
};

// Resolvers
exports.makeQueryResolver = (name, model, resolver, embeds = []) => {
  const obj = {};

  if (model.hasGQLScope('r')) {
    obj[`get${name}`] = resolveQuery('get', name, resolver, model, embeds);
    obj[`find${name}`] = resolveQuery('find', name, resolver, model, embeds);
    obj[`count${name}`] = resolveQuery('count', name, resolver, model, embeds);
  }

  return Object.assign(obj, makeEmbeddedResolver(model, resolver, 'query', embeds));
};

exports.makeMutationResolver = (name, model, resolver, embeds = []) => {
  const obj = {};

  if (model.hasGQLScope('c')) obj[`create${name}`] = resolveQuery('create', name, resolver, model, embeds);
  if (model.hasGQLScope('u')) obj[`update${name}`] = resolveQuery('update', name, resolver, model, embeds);
  if (model.hasGQLScope('d')) obj[`delete${name}`] = resolveQuery('delete', name, resolver, model, embeds);

  return Object.assign(obj, makeEmbeddedResolver(model, resolver, 'mutation', embeds));
};
