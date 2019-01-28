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
const crypto = require('crypto');
const path = require('path');
const os = require('os');
const fs = require('fs');
const sqlite = require('better-sqlite3');
const invariant = require('invariant');

const DB_DIR = '/tmp/graphqlite-3-' + Date.now();

const ALWAYS_CREATE = true;

try {
  fs.mkdirSync(DB_DIR);
} catch {}

function hashSchema(schema) {
  return crypto
    .createHash('sha1')
    .update(graphql.printSchema(schema))
    .digest('hex');
}

function typeToJSON(type) {
  if (type instanceof graphql.GraphQLList) {
    return {kind: 'list', ofType: typeToJSON(type.ofType)};
  } else if (type instanceof graphql.GraphQLNonNull) {
    return {kind: 'nonnull', ofType: typeToJSON(type.ofType)};
  } else {
    return {kind: 'named', name: type.name};
  }
}

function createDB(dbFile, schema) {
  const types = {};
  function getFieldDefs(type) {
    return Object.values(type.getFields()).map(field => ({
      name: field.name,
      type: typeToJSON(field.type),
      args: (field.args || []).map(arg => ({
        name: arg.name,
        type: typeToJSON(arg.type),
      })),
    }));
  }
  for (const [typeName, type] of Object.entries(schema.getTypeMap())) {
    if (type instanceof graphql.GraphQLEnumType) {
      types[typeName] = {
        kind: 'enum',
        values: type.getValues().map(value => value.value),
      };
    } else if (type instanceof graphql.GraphQLObjectType) {
      types[typeName] = {
        kind: 'object',
        interfaces: type.getInterfaces().map(iface => iface.name),
        fields: getFieldDefs(type),
      };
    } else if (type instanceof graphql.GraphQLInputObjectType) {
      types[typeName] = {
        kind: 'inputobject',
        fields: getFieldDefs(type),
      };
    } else if (type instanceof graphql.GraphQLScalarType) {
      types[typeName] = {
        kind: 'scalar',
      };
    } else if (type instanceof graphql.GraphQLInterfaceType) {
      types[typeName] = {
        kind: 'interface',
        types: schema.getPossibleTypes(type).map(type => type.name),
        fields: getFieldDefs(type),
      };
    } else if (type instanceof graphql.GraphQLUnionType) {
      types[typeName] = {
        kind: 'union',
        types: type.getTypes().map(type => type.name),
      };
    } else {
      throw new Error('unknown type: ' + type.name);
    }
  }

  const directives = schema.getDirectives().map(directive => ({
    name: directive.name,
    args: directive.args.map(arg => ({
      name: arg.name,
      type: typeToJSON(arg.type),
    })),
  }));

  const db = {
    types,
    directives,
  };
  fs.writeFileSync(dbFile, JSON.stringify(db, null, 2), 'utf8');
}

class DBSchema {
  constructor(db) {
    this.directives = db.directives;
    this.types = db.types;
  }

  getObjectInterfaces(objectTypeName: string) {
    const def = this.types[objectTypeName];
    invariant(
      def && def.kind === 'object',
      'should be an object, got: %s',
      def,
    );
    return def.interfaces;
  }

  getUnionTypes(unionTypeName: string) {
    const def = this.types[unionTypeName];
    invariant(def && def.kind === 'union', 'should be a union, got: %s', def);
    return def.types;
  }

  getEnumValues(enumName: string) {
    const def = this.types[enumName];
    invariant(def && def.kind === 'enum', 'should be an enum, got: %s', def);
    return def.values;
  }

  getPossibleTypes(abstractTypeName: string) {
    const def = this.types[abstractTypeName];
    invariant(
      def && (def.kind === 'interface' || def.kind === 'union'),
      'should be an enum, got: %s',
      def,
    );
    return def.types;
  }

  getFields(typeName: string) {
    const fields = this.types[typeName].fields;
    if (!fields) {
      throw new Error(`cannot get fields of ${typeName}`);
    }
    return fields;
  }

  getDirectives() {
    return this.directives;
  }
}

function dbForSchema(schema) {
  const dbFile = path.join(
    DB_DIR,
    `${hashSchema(schema.__realSchema || schema)}.sqlite`,
  );
  if (ALWAYS_CREATE || !fs.existsSync(dbFile)) {
    createDB(dbFile, schema);
  }
  return new DBSchema(JSON.parse(fs.readFileSync(dbFile, 'utf8')));
}

module.exports = {
  dbForSchema,
};
