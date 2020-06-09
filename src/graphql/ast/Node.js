const { get } = require('lodash');
const { Kind } = require('graphql');
const { uvl, nvl } = require('../../service/app.service');
const { mergeAST } = require('../../service/graphql.service');

const operations = ['Query', 'Mutation', 'Subscription'];
const modelKinds = [Kind.OBJECT_TYPE_DEFINITION, Kind.OBJECT_TYPE_EXTENSION];
const inputKinds = [Kind.INPUT_OBJECT_TYPE_DEFINITION, Kind.INPUT_OBJECT_TYPE_EXTENSION];
const scalarKinds = [Kind.SCALAR_TYPE_DEFINITION, Kind.SCALAR_TYPE_EXTENSION];
const enumKinds = [Kind.ENUM_TYPE_DEFINITION, Kind.ENUM_TYPE_EXTENSION];

module.exports = class Node {
  constructor(astLike) {
    this.ast = mergeAST(astLike);
    this.arguments = (this.ast.arguments || []).map(el => new Node(el));
    this.directives = (this.ast.directives || []).map(el => new Node(el));
    this.toString = () => this.getName();
  }

  // Basic AST Methods
  getAST() {
    return this.ast;
  }

  getKind() {
    return this.ast.kind;
  }

  getName() {
    return get(this.ast, 'name.value');
  }

  getValue(ast = this.ast) {
    const { value = {} } = ast;

    switch (value.kind) {
      case Kind.NULL: return null;
      case Kind.LIST: return value.values.map(el => this.getValue({ value: el }));
      case Kind.OBJECT: {
        return value.fields.reduce((prev, field) => {
          const node = new Node(field);
          return Object.assign(prev, { [node.getName()]: node.getValue() });
        }, {});
      }
      default: {
        if (ast.values) return ast.values.map(v => v.name.value);
        return value.value;
      }
    }
  }

  getDescription() {
    return get(this.ast, 'description.value');
  }

  // Directive Methods
  getDirectives(...names) {
    return this.directives.filter(directive => names.indexOf(directive.getName()) > -1);
  }

  getDirective(name) {
    return this.directives.find(directive => directive.getName() === name);
  }

  getDirectiveArg(name, arg, defaultValue) {
    const directive = this.getDirective(name);
    if (!directive) return defaultValue;
    return uvl(directive.getArg(arg), defaultValue);
  }

  getDirectiveArgs(name, defaultValue) {
    const directive = this.getDirective(name);
    if (!directive) return defaultValue;
    return directive.getArgs();
  }

  // Argument Methods
  getArgs() {
    return this.arguments.reduce((prev, arg) => {
      return Object.assign(prev, { [arg.getName()]: arg.getValue() });
    }, {});
  }

  getArg(arg) {
    return this.getArgs()[arg];
  }

  getArguments() {
    return this.arguments;
  }

  getArgument(name) {
    return this.getArguments().find(arg => arg.getName() === name);
  }

  // Framework Methods
  getKey(defaultValue) {
    return uvl(this.getDirectiveArg('model', 'key'), this.getDirectiveArg('field', 'key'), defaultValue, this.getName());
  }

  getOnDelete() {
    return this.getDirectiveArg('field', 'onDelete');
  }

  getDriverName() {
    return this.getDirectiveArg('model', 'driver', 'default');
  }

  getNamespace() {
    return this.getDirectiveArg('model', 'namespace', this.getName());
  }

  getVirtualRef() {
    return this.getDirectiveArg('field', 'materializeBy');
  }

  getAuthz() {
    return this.getDirectiveArg('field', 'authz', this.getDirectiveArg('model', 'authz', 'private'));
  }

  getMeta() {
    return this.getDirectiveArg('model', 'meta', 'AutoGraphMixed');
  }

  getCrud() {
    if (!this.getDirective('model')) return '';
    return nvl(uvl(this.getDirectiveArg('field', 'crud'), this.getDirectiveArg('model', 'crud'), 'crud'), '');
  }

  // Booleans
  isEntity() {
    return Boolean(this.getDirective('model')) && !this.isEmbedded();
  }

  isResolvable() {
    return Boolean(this.getDirective('model') && this.getCrud().length);
  }

  isVirtual() {
    return Boolean(this.getDirectiveArg('field', 'materializeBy'));
  }

  isEmbedded() {
    return Boolean(this.getDirectiveArg('model', 'embed'));
  }

  isModel() {
    return Boolean(modelKinds.some(k => this.getKind() === k) && operations.every(o => this.getName() !== o));
  }

  isInput() {
    return Boolean(inputKinds.some(k => this.getKind() === k));
  }

  isScalar() {
    return Boolean(scalarKinds.some(k => this.getKind() === k));
  }

  isEnum() {
    return Boolean(enumKinds.some(k => this.getKind() === k));
  }

  hasBoundValue() {
    return Boolean(this.getDirective('value'));
  }

  // API
  isCreatable() {
    return Boolean(this.getCrud().toLowerCase().indexOf('c') > -1);
  }

  isReadable() {
    return Boolean(this.getCrud().toLowerCase().indexOf('r') > -1);
  }

  isUpdatable() {
    return Boolean(this.getCrud().toLowerCase().indexOf('u') > -1);
  }

  isDeletable() {
    return Boolean(this.getCrud().toLowerCase().indexOf('d') > -1);
  }

  // Storage
  isPersistable() {
    return uvl(this.getDirectiveArg('field', 'persist'), this.getDirectiveArg('model', 'persist'), true);
  }

  isImmutable() {
    const enforce = this.getDirectiveArg('field', 'enforce', '');
    return Boolean(JSON.stringify(enforce).indexOf('immutable') > -1);
  }
};
