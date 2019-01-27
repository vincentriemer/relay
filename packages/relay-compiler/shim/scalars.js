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

function createScalarTypeProxy(wrappedType) {
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
            return wrappedType.toString;
          case 'name':
            return wrappedType.name;
          case 'toJSON':
            return wrappedType.toJSON;
          case 'constructor':
            return wrappedType.constructor;
          case 'parseLiteral':
            return wrappedType.parseLiteral;
          case Symbol.hasInstance:
            return obj => obj instanceof wrappedType;
        }
        throw new Error(`GET ScalareTypeProxy.${String(prop)}`);
      },
      getPrototypeOf() {
        return wrappedType.constructor.prototype;
      },
    },
  );
}

module.exports = {
  GraphQLInt: createScalarTypeProxy(graphql.GraphQLInt),
  GraphQLFloat: createScalarTypeProxy(graphql.GraphQLFloat),
  GraphQLString: createScalarTypeProxy(graphql.GraphQLString),
  GraphQLBoolean: createScalarTypeProxy(graphql.GraphQLBoolean),
  GraphQLID: createScalarTypeProxy(graphql.GraphQLID),
};
