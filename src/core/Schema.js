const Model = require('../data/Model');
const Drivers = require('../driver');
const Schema = require('../graphql/ast/Schema');
const crudExt = require('../graphql/extension/crud');
const specExt = require('../graphql/extension/spec');
const resolvableExt = require('../graphql/extension/resolvable');
const entityExt = require('../graphql/extension/entity');
const frameworkExt = require('../graphql/extension/framework');
const { identifyOnDeletes } = require('../service/schema.service');

// Export class
module.exports = class extends Schema {
  constructor(schema, stores) {
    super(schema);

    // Create drivers
    this.drivers = Object.entries(stores).reduce((prev, [key, value]) => {
      const { type } = value;
      const Driver = Drivers.require(type);

      return Object.assign(prev, {
        [key]: {
          dao: new Driver(value, this),
          idKey: Driver.idKey,
          idValue: Driver.idValue,
        },
      });
    }, {});

    // Create models
    this.createModels();

    // Create model indexes
    this.models.forEach((model) => {
      if (model.isEntity()) {
        const key = model.getKey();
        const indexes = model.getIndexes();
        const driver = model.getDriver();

        // Create collections (mongo)
        if (driver.createCollection) driver.createCollection(key);

        // Create indexes
        driver.createIndexes(key, indexes);
      }
    });
  }

  createModels() {
    this.models = super.getModels().map(model => new Model(this, model, this.drivers[model.getDriverName()]));
    this.models.forEach(model => model.referentialIntegrity(identifyOnDeletes(this.models, model)));
  }

  getSchema() {
    this.extend(frameworkExt(this));
    return super.getSchema();
  }

  loadDir(dir) {
    super.loadDir(dir);
    this.createModels();
    return this;
  }

  extend(...schemas) {
    super.extend(...schemas);
    this.createModels();
    return this;
  }

  getServerApiSchema() {
    // this.extend(frameworkExt(this), specExt(this), entityExt(this));
    // this.extend(crudExt(this), resolvableExt(this));
    return super.getSchema();
  }

  makeServerApiSchema() {
    this.extend(frameworkExt(this), specExt(this));
    // this.extend(frameworkExt(this), specExt(this), entityExt(this));
    // this.extend(crudExt(this), resolvableExt(this));
    return super.makeExecutableSchema();
  }
};
