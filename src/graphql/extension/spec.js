const ServerResolver = require('../../core/ServerResolver');
const { fromGUID } = require('../../service/app.service');

module.exports = (schema) => {
  const resolver = new ServerResolver();

  return ({
    typeDefs: `
      type Connection {
        edges: [Edge]
        pageInfo: PageInfo!
      }

      type Edge {
        node: Node
        cursor: String!
      }

      type PageInfo {
        startCursor: String!
        endCursor: String!
        hasPreviousPage: Boolean!
        hasNextPage: Boolean!
        totalCount: Int!
      }

      interface Node {
        id: ID!
      }

      type Query {
        node(id: ID!): Node
      }
    `,

    resolvers: {
      Node: {
        __resolveType: (root, args, context, info) => fromGUID(root.$id)[0],
      },
      Connection: {
        edges: root => root.map(node => ({ cursor: node.$$cursor, node })),
        pageInfo: root => root.$$pageInfo,
      },
      // Edge: {
      //   node: async (root, args, { autograph }, info) => {
      //     const { node } = root;
      //     const [modelName] = fromGUID(node.$id);
      //     const model = schema.getModel(modelName);
      //     return autograph.resolver.match(model).id(node.id).select(GraphqlFields(info, {}, { processArguments: true })).one();
      //   },
      // },
      Query: {
        node: (root, args, context, info) => {
          const { id } = args;
          const [modelName] = fromGUID(id);
          const model = schema.getModel(modelName);
          return resolver.get(context, model, id, false, info);
        },
      },
    },
  });
};
