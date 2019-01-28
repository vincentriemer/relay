/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 * @format
 */

'use strict';

const graphql = require('graphql');
const {
  GraphQLInt,
  GraphQLFloat,
  GraphQLString,
  GraphQLBoolean,
  GraphQLID,
} = require('./shim/scalars');
const {dbForSchema} = require('./shim/db');

function assertProxy(thing) {
  if (thing == null) {
    throw new Error('Expected a proxy, but got null/undef');
  }
  if (thing.__isProxy !== true) {
    throw new Error('Expected a proxy, but got an actual value');
  }
}

const GraphQLNonNull = new Proxy(function() {}, {
  get(target, prop) {
    switch (prop) {
      case Symbol.hasInstance:
        return instance => {
          return instance instanceof graphql.GraphQLNonNull;
        };
      case 'constructor':
        return graphql.GraphQLNonNull;
    }
    throw new Error(`GET GraphQLNonNull.${prop}`);
  },
  has(target, prop) {
    throw new Error(`HAS GraphQLNonNull.${prop}`);
  },
  construct(target, [ofType]) {
    assertProxy(ofType);
    return createNonNullTypeProxy(ofType);
  },
});

function createNonConstructableProxy(wrappedType) {
  return new Proxy(
    {},
    {
      get(target, prop) {
        switch (prop) {
          case '__isProxy':
            return true;
          case Symbol.toPrimitive:
            return undefined;
          case 'toString':
            return () => 'NonConstructableProxy';
          case Symbol.hasInstance:
            return obj => obj instanceof wrappedType;
        }
        throw new Error(`GET NonConstructableProxy.${String(prop)}`);
      },
    },
  );
}

function createNonNullTypeProxy(typeProxy) {
  assertProxy(typeProxy);
  return new Proxy(
    {},
    {
      get(target, prop) {
        switch (prop) {
          case '__isProxy':
            return true;
          case 'constructor':
            return graphql.GraphQLNonNull;
          case 'ofType':
            return typeProxy;
          case 'toJSON':
          case 'toString':
            return () => `${typeProxy}!`;
          case Symbol.iterator:
          case Symbol.toPrimitive:
          case 'asymmetricMatch':
          case require('util').inspect.custom:
          case Symbol.toStringTag:
            return undefined;
          default:
            throw new Error(`GET nonnull.${prop.toString()}`);
        }
      },
      getPrototypeOf() {
        return graphql.GraphQLNonNull.prototype;
      },
    },
  );
}

function createListProxy(typeProxy) {
  return new Proxy(
    {},
    {
      get(target, prop) {
        switch (prop) {
          case '__isProxy':
            return true;
          case 'constructor':
            return graphql.GraphQLList;
          case 'ofType':
            return typeProxy;
          case 'toJSON':
          case 'toString':
            return () => `[${typeProxy}]`;
          case Symbol.toPrimitive:
            return undefined;
          default:
            throw new Error(`GET list.${prop.toString()}`);
        }
      },
      getPrototypeOf() {
        return graphql.GraphQLList.prototype;
      },
    },
  );
}

function createSchemaProxy(realSchema) {
  const schemaDB = dbForSchema(realSchema);
  function createArgProxy(realArg) {
    return new Proxy(
      {},
      {
        get(target, prop, receiver) {
          switch (prop) {
            case '__isProxy':
              return true;
            case 'name':
              return realArg.name;
            case 'type':
              return createTypeProxyFromRealType(realArg.type);
            default:
              throw new Error(`GET arg.${prop}`);
          }
        },
      },
    );
  }

  function createArgProxyFromSpec(argSpec) {
    return new Proxy(
      {},
      {
        get(target, prop, receiver) {
          switch (prop) {
            case '__isProxy':
              return true;
            case 'name':
              return argSpec.name;
            case 'type':
              return createTypeProxyFromJSON(argSpec.type);
            default:
              throw new Error(`GET arg.${prop}`);
          }
        },
      },
    );
  }

  function createFieldProxy(spec) {
    return new Proxy(
      {},
      {
        get(target, prop, receiver) {
          switch (prop) {
            case '__isProxy':
              return true;
            case 'type':
              return createTypeProxyFromJSON(spec.type);
            case 'args':
              return spec.args.map(argSpec => createArgProxyFromSpec(argSpec));
            case 'name':
              return spec.name;
            default:
              throw new Error(`GET field<${typeName}.${fieldName}>.${prop}`);
          }
        },
      },
    );
  }

  function createDirectiveProxy(directiveName) {
    const realDirective = realSchema.getDirective(directiveName);
    return new Proxy(
      {},
      {
        get(target, prop, receiver) {
          switch (prop) {
            case '__isProxy':
              return true;
            case 'args':
              return realDirective.args.map(arg => createArgProxy(arg));
            case 'name':
              return realDirective.name;
            default:
              throw new Error(`GET directive<${directiveName}>.${prop}`);
          }
        },
      },
    );
  }

  function createFieldMapProxy(typeName) {
    const realType = realSchema.getType(typeName);
    const realFields = realType.getFields();
    const map = {};
    schemaDB.getFields(typeName).forEach(fieldSpec => {
      map[fieldSpec.name] = createFieldProxy(fieldSpec);
    });
    return map;
  }

  function createTypeProxyFromRealType(realType) {
    switch (realType.name) {
      case 'Int':
        return GraphQLInt;
      case 'Float':
        return GraphQLFloat;
      case 'String':
        return GraphQLString;
      case 'Boolean':
        return GraphQLBoolean;
      case 'ID':
        return GraphQLID;
    }
    if (realType instanceof graphql.GraphQLNonNull) {
      return createNonNullTypeProxy(
        createTypeProxyFromRealType(realType.ofType),
      );
    }
    if (realType instanceof graphql.GraphQLList) {
      return createListProxy(createTypeProxyFromRealType(realType.ofType));
    }
    return createTypeProxy(realType.name);
  }

  function createTypeProxyFromJSON(def) {
    switch (def.kind) {
      case 'named':
        switch (def.name) {
          case 'Int':
            return GraphQLInt;
          case 'Float':
            return GraphQLFloat;
          case 'String':
            return GraphQLString;
          case 'Boolean':
            return GraphQLBoolean;
          case 'ID':
            return GraphQLID;
          default:
            return createTypeProxy(def.name);
        }
      case 'nonnull':
        return createNonNullTypeProxy(createTypeProxyFromJSON(def.ofType));
      case 'list':
        return createListProxy(createTypeProxyFromJSON(def.ofType));
      default:
        throw new Error(`unhandled kind: ${def.kind}`);
    }
  }

  const typeProxyCache = new Map();
  function createTypeProxy(typeName) {
    switch (typeName) {
      case 'Int':
        return GraphQLInt;
      case 'Float':
        return GraphQLFloat;
      case 'String':
        return GraphQLString;
      case 'Boolean':
        return GraphQLBoolean;
      case 'ID':
        return GraphQLID;
    }
    if (typeName == null) {
      throw new Error('createTypeProxy called with null/undef');
    }
    let result = typeProxyCache.get(typeName);
    if (result == null) {
      const realType = realSchema.getType(typeName);
      if (realType == null) {
        return null;
      }
      result = new Proxy(
        {},
        {
          get(target, prop, receiver) {
            switch (prop) {
              case '__isProxy':
                return true;
              case 'constructor':
                return realType.constructor;
              case 'toJSON':
              case 'toString':
                return () => typeName;
              case 'getFields':
                return () => createFieldMapProxy(typeName);
              case 'name':
                return typeName;
              case 'getInterfaces':
                return () =>
                  schemaDB
                    .getObjectInterfaces(typeName)
                    .map(interfaceName => createTypeProxy(interfaceName));
              case 'getTypes':
                return () =>
                  schemaDB
                    .getUnionTypes(typeName)
                    .map(name => createTypeProxy(name));
              case 'parseLiteral':
                return ast => realType.parseLiteral(ast);
              case 'getValues':
                return () =>
                  schemaDB.getEnumValues(typeName).map(value => ({value}));
              case 'asymmetricMatch':
              case Symbol.for('util.inspect.custom'):
              case require('util').inspect.custom:
              case Symbol.toStringTag:
              case Symbol.iterator:
              case Symbol.toPrimitive:
                return undefined;
              default:
                throw new Error(`GET type<${typeName}>.${prop.toString()}`);
            }
          },
          getPrototypeOf() {
            return realType.constructor.prototype;
          },
        },
      );
      typeProxyCache.set(typeName, result);
    }
    return result;
  }

  return new Proxy(realSchema, {
    get(target, prop, receiver) {
      switch (prop) {
        case '__isProxy':
          return true;
        case '__createTypeProxyFromRealType':
          return createTypeProxyFromRealType;
        case '__realSchema':
          return realSchema;
        case 'getType':
          return name => createTypeProxy(name);
        case 'getQueryType':
          return () => createTypeProxy('Query');
        case 'getMutationType':
          return () => createTypeProxy('Mutation');
        case 'getSubscriptionType':
          return () => createTypeProxy('Subscription');
        case 'getPossibleTypes':
          return abstractType =>
            schemaDB.getPossibleTypes(abstractType.name).map(createTypeProxy);
        case 'getDirective':
          return createDirectiveProxy;
        case 'getDirectives':
          return () =>
            schemaDB.getDirectives().map(def => createDirectiveProxy(def.name));
        case '__validationErrors':
          return target[prop];
        default:
          throw new Error(`GET schema.${String(prop)} unhandled`);
      }
    },
    set(target, prop, value, receiver) {
      switch (prop) {
        case '__validationErrors':
          target.__validationErrors = value;
          return true;
      }
      throw new Error(`SET schema.${prop}`);
    },
    getPrototypeOf() {
      return graphql.GraphQLSchema.prototype;
    },
  });
}

function buildASTSchema(ast, options) {
  return createSchemaProxy(graphql.buildASTSchema(ast, options));
}

function typeFromAST(schema, ast) {
  return schema.__createTypeProxyFromRealType(
    graphql.typeFromAST(schema.__realSchema, ast),
  );
}

function extendSchema(schema, ast, options) {
  return createSchemaProxy(
    graphql.extendSchema(schema.__realSchema, ast, options),
  );
}

function validate() {
  // TODO
}

module.exports = new Proxy(
  {
    typeFromAST,
    buildASTSchema,
    extendSchema,
    validate,
    GraphQLNonNull,
    GraphQLEnumType: createNonConstructableProxy(graphql.GraphQLEnumType),
    GraphQLUnionType: createNonConstructableProxy(graphql.GraphQLUnionType),

    GraphQLInt,
    GraphQLFloat,
    GraphQLString,
    GraphQLBoolean,
    GraphQLID,

    GraphQLError: graphql.GraphQLError,
    Source: graphql.Source,

    assertCompositeType: graphql.assertCompositeType,
    assertInputType: graphql.assertInputType,
    assertOutputType: graphql.assertOutputType,
    assertLeafType: graphql.assertLeafType,
    assertAbstractType: graphql.assertAbstractType,

    getNamedType: graphql.getNamedType,
    getNullableType: graphql.getNullableType,

    isLeafType: graphql.isLeafType,
    isType: graphql.isType,
    isTypeSubTypeOf: graphql.isTypeSubTypeOf,

    parse: graphql.parse,
    parseType: graphql.parseType,
    print: graphql.print,
    visit: graphql.visit,

    SchemaMetaFieldDef: graphql.SchemaMetaFieldDef,
    TypeMetaFieldDef: graphql.TypeMetaFieldDef,
    TypeNameMetaFieldDef: graphql.TypeNameMetaFieldDef,

    GraphQLList: graphql.GraphQLList,
    GraphQLInputObjectType: graphql.GraphQLInputObjectType,
    GraphQLInterfaceType: graphql.GraphQLInterfaceType,
    GraphQLObjectType: graphql.GraphQLObjectType,
    GraphQLScalarType: graphql.GraphQLScalarType,

    FragmentsOnCompositeTypesRule: graphql.FragmentsOnCompositeTypesRule,
    KnownArgumentNamesRule: graphql.KnownArgumentNamesRule,
    KnownTypeNamesRule: graphql.KnownTypeNamesRule,
    LoneAnonymousOperationRule: graphql.LoneAnonymousOperationRule,
    NoUnusedVariablesRule: graphql.NoUnusedVariablesRule,
    PossibleFragmentSpreadsRule: graphql.PossibleFragmentSpreadsRule,
    UniqueArgumentNamesRule: graphql.UniqueArgumentNamesRule,
    UniqueFragmentNamesRule: graphql.UniqueFragmentNamesRule,
    UniqueInputFieldNamesRule: graphql.UniqueInputFieldNamesRule,
    UniqueOperationNamesRule: graphql.UniqueOperationNamesRule,
    UniqueVariableNamesRule: graphql.UniqueVariableNamesRule,
    ValuesOfCorrectTypeRule: graphql.ValuesOfCorrectTypeRule,
    VariablesAreInputTypesRule: graphql.VariablesAreInputTypesRule,
    VariablesInAllowedPositionRule: graphql.VariablesInAllowedPositionRule,
  },
  {
    get(target, prop) {
      if (target.hasOwnProperty(prop)) {
        return target[prop];
      }
      throw new Error(`missing graphql-shim prop: ${prop}`);
    },
  },
);
