const GraphqlFields = require('graphql-fields');
const ServerResolver = require('../../core/ServerResolver');

module.exports = (schema) => {
  const resolver = new ServerResolver();

  return ({
    resolvers: schema.getResolvableModels().reduce((prev, model) => {
      const modelName = model.getName();

      return Object.assign(prev, {
        [modelName]: model.getSelectFields().reduce((def, field) => {
          const fieldName = field.getName();
          if (fieldName === 'id') return Object.assign(def, { id: (root, args, { autograph }) => (autograph.legacyMode ? root.id : root.$id) });
          return Object.assign(def, { [fieldName]: root => root[`$${fieldName}`] });
        }, {}),
      });
    }, {
      Query: schema.getReadModels().reduce((prev, model) => {
        const modelName = model.getName();

        return Object.assign(prev, {
          [`get${modelName}`]: (root, args, context, info) => resolver.get(context, model, args.id, true, info),
          [`find${modelName}`]: (root, args, context, info) => resolver.query(context, model, args, info),
          [`count${modelName}`]: (root, args, context, info) => resolver.count(context, model, args, info),
        });
      }, {}),

      Mutation: schema.getChangeModels().reduce((prev, model) => {
        const obj = {};
        const modelName = model.getName();

        if (model.isCreatable()) obj[`create${modelName}`] = (root, args, context, info) => resolver.create(context, model, args.input, args.meta, { fields: GraphqlFields(info, {}, { processArguments: true }) });
        if (model.isUpdatable()) obj[`update${modelName}`] = (root, args, context, info) => resolver.update(context, model, args.id, args.input, args.meta, { fields: GraphqlFields(info, {}, { processArguments: true }) });
        if (model.isDeletable()) obj[`delete${modelName}`] = (root, args, context, info) => resolver.delete(context, model, args.id, args.meta, { fields: GraphqlFields(info, {}, { processArguments: true }) });

        return Object.assign(prev, obj);
      }, {}),
    }),
  });
};
