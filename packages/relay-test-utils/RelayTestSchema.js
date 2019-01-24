/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict
 * @format
 */

'use strict';

const RelayTestSchemaPath = require('./RelayTestSchemaPath');

const fs = require('fs');

const graphql = require('graphql-shim');
const {
  buildASTSchema,
  parse,
  parseType,
  GraphQLSchema,
  GraphQLNonNull,
  GraphQLScalarType,
} = require('graphql-shim');

const realSchema = buildASTSchema(
  parse(fs.readFileSync(RelayTestSchemaPath, 'utf8'), {assumeValid: true}),
);

function createSchemaProxy(realSchema) {
  function createFieldProxy(typeName, fieldName) {
    const realField = realSchema.getType(typeName).getFields()[fieldName];
    return new Proxy(
      {},
      {
        get(target, prop, receiver) {
          switch (prop) {
            case '__isProxy':
              return true;
            case 'type':
              return createTypeProxyFromRealType(realField.type);
            case 'args':
              // TODO
              return [];
            default:
              console.log(`GET field<${typeName}.${fieldName}>.${prop}`);
          }
        },
      },
    );
  }

  function createFieldMapProxy(typeName) {
    const realType = realSchema.getType(typeName);
    const realFields = realType.getFields();
    return new Proxy(
      {},
      {
        get(target, prop, receiver) {
          console.log(`GET fieldMap<${typeName}>.${prop}`);
          if (prop in realFields) {
            return createFieldProxy(typeName, prop);
          }
        },
        has(target, prop) {
          console.log(`HAS fieldMap<${typeName}>`);
        },
      },
    );
  }

  function createNonNullTypeProxy(typeProxy) {
    return new Proxy(
      {},
      {
        get(target, prop) {
          switch (prop) {
            case '__isProxy':
              return true;
            case 'constructor':
              return GraphQLNonNull;
            case 'ofType':
              return typeProxy;
            case 'toString':
              return () => 'ffffff';
            default:
              console.log(`GET nonnull.${prop.toString()}`);
          }
        },
        getPrototypeOf() {
          return GraphQLNonNull.prototype;
        },
      },
    );
  }

  function createTypeProxyFromRealType(realType) {
    if (realType instanceof GraphQLNonNull) {
      return createNonNullTypeProxy(
        createTypeProxyFromRealType(realType.ofType),
      );
    }
    return createTypeProxy(realType.name);
  }

  const typeProxyCache = new Map();
  function createTypeProxy(typeName) {
    let result = typeProxyCache.get(typeName);
    if (result == null) {
      result = new Proxy(
        {},
        {
          has(target, prop) {
            console.log(`HAS type<${typeName}>.${prop}`);
            return false;
          },
          get(target, prop, receiver) {
            switch (prop) {
              case '__isProxy':
                return true;
              case 'constructor':
                return realSchema.getType(typeName).constructor;
              case 'toString':
                return () => `ProxyThing<${typeName}>`;
              case 'getFields':
                return () => createFieldMapProxy(typeName);
              default:
                console.log(`GET type<${typeName}>.${prop.toString()}`);
            }
          },
          set(target, prop, value, receiver) {
            console.log(`SET schema.${prop}`);
          },
          getPrototypeOf() {
            return realSchema.getType(typeName).constructor.prototype;
          },
        },
      );
      typeProxyCache.set(typeName, result);
    }
    return result;
  }

  return new Proxy(realSchema, {
    has(target, prop) {
      console.log(`HAS schema.${prop}`);
      return false;
    },
    get(target, prop, receiver) {
      switch (prop) {
        case '__isProxy':
          return true;
        case 'magic':
          return createNonNullTypeProxy(createTypeProxy('ID'));
        case 'magic2':
          return createTypeProxy('ID');
        case 'getType':
          return name => createTypeProxy(name);
        case 'getQueryType':
        case 'getMutationType':
        case 'getSubscriptionType':
        case 'getDirectives':
        case 'getTypeMap':
        case 'getDirective':
          // console.log(`GET schema.${prop} = ${target[prop]}`);
          return (...args) => target[prop](...args);
        case '__allowedLegacyNames':
        case '__validationErrors':
          return target[prop];
        default:
          console.log(`GET schema.${prop}`);
      }
    },
    set(target, prop, value, receiver) {
      console.log(`SET schema.${prop}`);

      switch (prop) {
        case '__validationErrors':
          target.__validationErrors = value;
          return true;
      }
    },
    getPrototypeOf() {
      return GraphQLSchema.prototype;
    },
  });
}

const proxySchema = createSchemaProxy(realSchema);

// throw new Error('end');

module.exports = proxySchema;
