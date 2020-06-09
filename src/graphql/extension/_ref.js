// type Schema {
//   _noop: String
//   ${schemaReadModels.map(model => `get${model.getName()}(id: ID!): ${model.getName()} `)}
//   ${schemaReadModels.map(model => `find${model.getName()}(first: Int after: String last: Int before: String query: ${ucFirst(model.getName())}InputQuery): Connection!`)}
//   ${schemaReadModels.map(model => `count${model.getName()}(where: ${ucFirst(model.getName())}InputWhere): Int!`)}
// }

// // Resolvers
// Query: {
//   Schema: () => ({}),
// }

// Schema: schemaReadModels.reduce((prev, model) => {
//   const modelName = model.getName();

//   return Object.assign(prev, {
//     [`get${modelName}`]: (root, args, context, info) => resolver.get(context, model, args.id, true, info),
//     [`find${modelName}`]: (root, args, context, info) => resolver.query(context, model, args, info),
//     [`count${modelName}`]: (root, args, context, info) => resolver.count(context, model, args, info),
//   });
// }, {}),