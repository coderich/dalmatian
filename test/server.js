const FS = require('fs');
const Path = require('path');
const { ApolloServer } = require('apollo-server');
const Schema = require('../src/core/Schema');
const Resolver = require('../src/core/Resolver');
const gqlSchema = require('./fixtures/schema');
const stores = require('./stores');

// const loadFile = file => FS.readFileSync(Path.resolve(file), 'utf8');
// const typeDefs = loadFile(`${__dirname}/fixtures/complex.graphql`);

class Server {
  constructor() {
    const schema = new Schema(gqlSchema, stores);
    const executableSchema = schema.makeServerApiSchema();

    this.server = new ApolloServer({
      schema: executableSchema,
      context: () => ({
        autograph: {
          schema,
          permissions: ['**'],
          legacyMode: true,
          resolver: new Resolver(schema),
        },
      }),
    });
  }

  start() {
    this.server.listen(3000).then(({ url, subscriptionsUrl }) => {
      console.log(`Server running: ${url}`);
      console.log(`Subscriptions running: ${subscriptionsUrl}`);
    });
  }
}

new Server().start();
