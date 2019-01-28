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

function memoize0(fn) {
  let computed = false;
  let result;
  return () => {
    if (!computed) {
      computed = true;
      result = fn();
    }
    return result;
  };
}

function memoize1(fn) {
  let results = new Map();
  return arg => {
    if (!results.has(arg)) {
      results.set(arg, fn(arg));
    }
    return results.get(arg);
  };
}

function getConstructorForKind(kind) {
  switch (kind) {
    case 'object':
      return graphql.GraphQLObjectType;
    case 'interface':
      return graphql.GraphQLInterfaceType;
    case 'union':
      return graphql.GraphQLUnionType;
    case 'inputobject':
      return graphql.GraphQLInputObjectType;
    case 'enum':
      return graphql.GraphQLEnumType;
    case 'scalar':
      return graphql.GraphQLScalarType;
    default:
      throw new Error(`unhandled kind ${kind}`);
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
            return () => `${String(typeProxy)}!`;
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
  assertProxy(typeProxy);
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
            return () => `[${String(typeProxy)}]`;
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

  function createField(fieldSpec) {
    return {
      type: createTypeProxyFromJSON(fieldSpec.type),
      args: fieldSpec.args.map(argSpec => createArgProxyFromSpec(argSpec)),
      name: fieldSpec.name,
    };
  }

  function createTypeProxyFromJSON(def) {
    switch (def.kind) {
      case 'named':
        return createTypeProxy(def.name);
      case 'nonnull':
        return createNonNullTypeProxy(createTypeProxyFromJSON(def.ofType));
      case 'list':
        return createListProxy(createTypeProxyFromJSON(def.ofType));
      default:
        throw new Error(`unhandled kind: ${def.kind}`);
    }
  }

  function createTypeProxyFromAST(ast) {
    switch (ast.kind) {
      case 'NamedType':
        return createTypeProxy(ast.name.value);
      case 'NonNullType':
        return createNonNullTypeProxy(createTypeProxyFromAST(ast.type));
      case 'ListType':
        return createListProxy(createTypeProxyFromAST(ast.type));
      default:
        throw new Error(`unhandled kind: ${ast.kind}`);
    }
  }

  const scalarTypes = new Map([
    ['Int', GraphQLInt],
    ['Float', GraphQLFloat],
    ['String', GraphQLString],
    ['Boolean', GraphQLBoolean],
    ['ID', GraphQLID],
  ]);
  const createTypeProxy = memoize1(typeName => {
    if (typeName == null) {
      throw new Error('createTypeProxy called with null/undef');
    }
    const scalarType = scalarTypes.get(typeName);
    if (scalarType != null) {
      return scalarType;
    }
    if (!schemaDB.hasType(typeName)) {
      return undefined;
    }
    return new Proxy(
      {
        constructor: getConstructorForKind(schemaDB.getKind(typeName)),
        getFields: memoize0(() => {
          const map = {};
          schemaDB.getFields(typeName).forEach(fieldSpec => {
            map[fieldSpec.name] = createField(fieldSpec);
          });
          return map;
        }),
        getInterfaces: memoize0(() =>
          schemaDB
            .getObjectInterfaces(typeName)
            .map(interfaceName => createTypeProxy(interfaceName)),
        ),
        getTypes: memoize0(() =>
          schemaDB.getUnionTypes(typeName).map(name => createTypeProxy(name)),
        ),
        parseLiteral: ast => {
          if (ast.kind === 'EnumValue') {
            const allowedValues = schemaDB.getEnumValues(typeName);
            return allowedValues.includes(ast.value) ? ast.value : undefined;
          }
          // TODO doesn't seem right, but no test fails
          return undefined;
        },
        getValues: memoize0(() =>
          schemaDB.getEnumValues(typeName).map(value => ({value})),
        ),
        toJSON: () => typeName,
        toString: () => typeName,
        __isProxy: true,
        name: typeName,
        asymmetricMatch: undefined,
        [Symbol.for('util.inspect.custom')]: undefined,
        [require('util').inspect.custom]: undefined,
        [Symbol.toStringTag]: undefined,
        [Symbol.iterator]: undefined,
        [Symbol.toPrimitive]: undefined,
      },
      {
        get(target, prop, receiver) {
          if (target.hasOwnProperty(prop)) {
            return target[prop];
          }
          throw new Error(`GET type<${typeName}>.${prop.toString()}`);
        },
        getPrototypeOf() {
          return getConstructorForKind(schemaDB.getKind(typeName)).prototype;
        },
      },
    );
  });

  const directivesMap = new Map(
    schemaDB.getDirectives().map(spec => [
      spec.name,
      {
        args: spec.args.map(arg => createArgProxyFromSpec(arg)),
        name: spec.name,
      },
    ]),
  );

  return new Proxy(realSchema, {
    get(target, prop, receiver) {
      switch (prop) {
        case '__isProxy':
          return true;
        case 'typeFromAST':
          return ast => createTypeProxyFromAST(ast);
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
          return directiveName => directivesMap.get(directiveName);
        case 'getDirectives':
          return () => Array.from(directivesMap.values());
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
  return schema.typeFromAST(ast);
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
