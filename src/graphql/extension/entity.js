const { ucFirst } = require('../../service/app.service');

module.exports = (schema) => {
  return ({
    typeDefs: schema.getEntityModels().map((model) => {
      const modelName = model.getName();
      const createdAt = model.getDirectiveArg('model', 'createdAt', 'createdAt');
      const updatedAt = model.getDirectiveArg('model', 'updatedAt', 'updatedAt');

      return `
        extend type ${modelName} implements Node {
          id: ID! @field(key: "${model.idKey()}")
          ${createdAt ? `createdAt: AutoGraphDateTime @field(crud: "r", key: "${createdAt}")` : ''}
          ${updatedAt ? `updatedAt: AutoGraphDateTime @field(crud: "r", key: "${updatedAt}")` : ''}
          # ${model.getCountableFields().map(field => `count${ucFirst(field.getName())}(where: ${field.getDataRef()}InputWhere): Int @field(crud: "r" persist: false)`)}
          # countSelf(where: ${modelName}InputWhere): Int @field(crud: "r" persist: false)
        }
      `;
    }),
  });
};
