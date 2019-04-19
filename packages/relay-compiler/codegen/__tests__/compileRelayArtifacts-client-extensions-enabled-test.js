/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @format
 * @flow
 * @emails oncall+relay
 */

'use strict';

const ASTConvert = require('../../core/ASTConvert');
const CodeMarker = require('../../util/CodeMarker');
const CompilerContext = require('../../core/GraphQLCompilerContext');
const RelayIRTransforms = require('../../core/RelayIRTransforms');

const compileRelayArtifacts = require('../compileRelayArtifacts');

const {RelayFeatureFlags} = require('@vincentriemer/relay-runtime');
const {
  TestSchema,
  generateTestsFromFixtures,
  parseGraphQLText,
} = require('@vincentriemer/relay-test-utils');

describe('compileRelayArtifacts (ClientExtension transforms enabled)', () => {
  let previousEnableClientExtensionsTransform;

  beforeEach(() => {
    previousEnableClientExtensionsTransform =
      RelayFeatureFlags.ENABLE_CLIENT_EXTENSIONS;
    RelayFeatureFlags.ENABLE_CLIENT_EXTENSIONS = true;
  });

  afterEach(() => {
    RelayFeatureFlags.ENABLE_CLIENT_EXTENSIONS = previousEnableClientExtensionsTransform;
  });

  generateTestsFromFixtures(
    `${__dirname}/fixtures/compileRelayArtifacts-client-extensions-enabled`,
    text => {
      const relaySchema = ASTConvert.transformASTSchema(
        TestSchema,
        RelayIRTransforms.schemaExtensions,
      );
      const {definitions, schema} = parseGraphQLText(relaySchema, text);
      // $FlowFixMe
      const compilerContext = new CompilerContext(TestSchema, schema).addAll(
        definitions,
      );
      return compileRelayArtifacts(compilerContext, RelayIRTransforms)
        .map(([_definition, node]) => {
          if (node.kind === 'Request') {
            const {
              params: {text: queryText},
              ...ast
            } = node;
            return [stringifyAST(ast), 'QUERY:', queryText].join('\n\n');
          } else {
            return stringifyAST(node);
          }
        })
        .join('\n\n');
    },
  );
});

function stringifyAST(ast: mixed): string {
  return CodeMarker.postProcess(
    // $FlowFixMe(>=0.95.0) JSON.stringify can return undefined
    JSON.stringify(ast, null, 2),
    moduleName => `require('${moduleName}')`,
  );
}
