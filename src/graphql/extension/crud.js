const { ucFirst } = require('../../service/app.service');

module.exports = (schema) => {
  return ({
    typeDefs: schema.getResolvableModels().map((model) => {
      const modelName = model.getName();

      return `
        ${model.isCreatable() ? `input ${modelName}InputCreate {
          ${model.getCreateFields().map(field => `${field.getName()}: ${field.getGQLType('InputCreate')}`)}
        }` : ''}

        ${model.isUpdatable() ? `input ${modelName}InputUpdate {
          ${model.getUpdateFields().map(field => `${field.getName()}: ${field.getGQLType('InputUpdate')}`)}
        }` : ''}

        ${model.getWhereFields().length ? `input ${modelName}InputWhere {
          ${model.getWhereFields().map(field => `${field.getName()}: ${field.getDataRef() ? `${ucFirst(field.getDataRef())}InputWhere` : 'String'}`)}
          # ${model.getCountableFields().map(field => `count${ucFirst(field.getName())}: String`)}
        }` : ''}

        ${model.getSelectFields().length ? `input ${modelName}InputSort {
          ${model.getSelectFields().map(field => `${field.getName()}: ${field.getDataRef() ? `${ucFirst(field.getDataRef())}InputSort` : 'SortOrderEnum'}`)}
          # ${model.getCountableFields().map(field => `count${ucFirst(field.getName())}: SortOrderEnum`)}
        }` : ''}

        input ${modelName}InputQuery {
          where: ${modelName}InputWhere
          sortBy: ${modelName}InputSort
          limit: Int
        }

        type ${modelName}Subscription {
          op: String!
          model: ${modelName}!
        }
      `;
    }).concat([
      'enum SortOrderEnum { ASC DESC }',

      `type Query {
        _noop: String
        ${schema.getReadModels().map(model => `get${model.getName()}(id: ID!): ${model.getName()} `)}
        ${schema.getReadModels().map(model => `find${model.getName()}(first: Int after: String last: Int before: String query: ${ucFirst(model.getName())}InputQuery): Connection!`)}
        ${schema.getReadModels().map(model => `count${model.getName()}(where: ${ucFirst(model.getName())}InputWhere): Int!`)}
      }`,

      `type Mutation {
        _noop: String
        ${schema.getCreateModels().map(model => `create${model.getName()}(input: ${model.getName()}InputCreate! meta: ${model.getMeta()}): ${model.getName()}! `)}
        ${schema.getUpdateModels().map(model => `update${model.getName()}(id: ID! input: ${model.getName()}InputUpdate meta: ${model.getMeta()}): ${model.getName()}! `)}
        ${schema.getDeleteModels().map(model => `delete${model.getName()}(id: ID! meta: ${model.getMeta()}): ${model.getName()}! `)}
      }`,

      `type Subscription {
        _noop: String
        ${schema.getChangeModels().map(model => `${model.getName()}Trigger(first: Int after: String last: Int before: String query: ${ucFirst(model.getName())}InputQuery): Connection!`)}
        ${schema.getChangeModels().map(model => `${model.getName()}Changed(query: ${ucFirst(model.getName())}InputQuery): [${model.getName()}Subscription]!`)}
      }`,
    ]),
  });
};
