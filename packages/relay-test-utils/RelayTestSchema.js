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

const graphql = require('graphql');
const {
  buildASTSchema,
  parse,
  GraphQLSchema,
  GraphQLScalarType,
} = require('graphql');

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
            case 'type':
              let rawType = realField.type;
              while (rawType.ofType) rawType = rawType.ofType;
              return createTypeProxy(rawType.name);
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

  function createTypeProxy(typeName) {
    return new Proxy(
      {},
      {
        has(target, prop) {
          console.log(`HAS type<${typeName}>.${prop}`);
          return false;
        },
        get(target, prop, receiver) {
          switch (prop) {
            case 'constructor':
              return realSchema.getType(typeName).constructor;
            // return graphql.GraphQLScalarType;
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
  }

  return new Proxy(realSchema, {
    has(target, prop) {
      console.log(`HAS schema.${prop}`);
      return false;
    },
    get(target, prop, receiver) {
      switch (prop) {
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

module.exports = proxySchema;
