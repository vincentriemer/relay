/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict-local
 * @format
 */

'use strict';

const ClientExtensionsTransform = require('../transforms/ClientExtensionsTransform');
const FilterDirectivesTransform = require('../transforms/FilterDirectivesTransform');
const FlattenTransform = require('../transforms/FlattenTransform');
const InlineFragmentsTransform = require('../transforms/InlineFragmentsTransform');
const RefineOperationVariablesTransform = require('../transforms/RefineOperationVariablesTransform');
const RelayApplyFragmentArgumentTransform = require('../transforms/RelayApplyFragmentArgumentTransform');
const RelayConnectionTransform = require('../handlers/connection//RelayConnectionTransform');
const RelayDeferStreamTransform = require('../transforms/RelayDeferStreamTransform');
const RelayFieldHandleTransform = require('../transforms/RelayFieldHandleTransform');
const RelayGenerateIDFieldTransform = require('../transforms/RelayGenerateIDFieldTransform');
const RelayGenerateTypeNameTransform = require('../transforms/RelayGenerateTypeNameTransform');
const RelayMaskTransform = require('../transforms/RelayMaskTransform');
const RelayMatchTransform = require('../transforms/RelayMatchTransform');
const RelayRefetchableFragmentTransform = require('../transforms/RelayRefetchableFragmentTransform');
const RelayRelayDirectiveTransform = require('../transforms/RelayRelayDirectiveTransform');
const RelaySkipHandleFieldTransform = require('../transforms/RelaySkipHandleFieldTransform');
const RelaySplitModuleImportTransform = require('../transforms/RelaySplitModuleImportTransform');
const RelayTestOperationTransform = require('../transforms/RelayTestOperationTransform');
const RelayViewerHandleTransform = require('../handlers/viewer/RelayViewerHandleTransform');
const SkipClientExtensionsTransform = require('../transforms/SkipClientExtensionsTransform');
const SkipClientFieldTransform = require('../transforms/SkipClientFieldTransform');
const SkipRedundantNodesTransform = require('../transforms/SkipRedundantNodesTransform');
const SkipUnreachableNodeTransform = require('../transforms/SkipUnreachableNodeTransform');

const {RelayFeatureFlags} = require('@vincentriemer/relay-runtime');

import type {IRTransform} from './GraphQLCompilerContext';

// Transforms applied to the code used to process a query response.
const relaySchemaExtensions: Array<string> = [
  RelayConnectionTransform.SCHEMA_EXTENSION,
  RelayMatchTransform.SCHEMA_EXTENSION,
  RelayRelayDirectiveTransform.SCHEMA_EXTENSION,
  RelayRefetchableFragmentTransform.SCHEMA_EXTENSION,
  RelayTestOperationTransform.SCHEMA_EXTENSION,
];

// Transforms applied to both operations and fragments for both reading and
// writing from the store.
const relayCommonTransforms: Array<IRTransform> = [
  RelayFeatureFlags.ENABLE_CLIENT_EXTENSIONS === true
    ? ClientExtensionsTransform.transform
    : null,
  RelayConnectionTransform.transform,
  RelayRelayDirectiveTransform.transform,
  RelayMaskTransform.transform,
  RelayMatchTransform.transform,
  RelayRefetchableFragmentTransform.transform,
  RelayViewerHandleTransform.transform,
].filter(Boolean);

// Transforms applied to fragments used for reading data from a store
const relayFragmentTransforms: Array<IRTransform> = [
  RelayFieldHandleTransform.transform,
  FlattenTransform.transformWithOptions({flattenAbstractTypes: true}),
  SkipRedundantNodesTransform.transform,
];

// Transforms applied to queries/mutations/subscriptions that are used for
// fetching data from the server and parsing those responses.
const relayQueryTransforms: Array<IRTransform> = [
  RelayApplyFragmentArgumentTransform.transform,
  RelayFeatureFlags.ENABLE_CLIENT_EXTENSIONS === true
    ? null
    : SkipClientFieldTransform.transform,
  SkipUnreachableNodeTransform.transform,
  RelayGenerateIDFieldTransform.transform,
  RelayDeferStreamTransform.transform,
  RelayTestOperationTransform.transform,
].filter(Boolean);

// Transforms applied to the code used to process a query response.
const relayCodegenTransforms: Array<IRTransform> = [
  RelaySplitModuleImportTransform.transform,
  InlineFragmentsTransform.transform,
  FlattenTransform.transformWithOptions({flattenAbstractTypes: true}),
  SkipRedundantNodesTransform.transform,
  RelayGenerateTypeNameTransform.transform,
  FilterDirectivesTransform.transform,
];

// Transforms applied before printing the query sent to the server.
const relayPrintTransforms: Array<IRTransform> = [
  RelayFeatureFlags.ENABLE_CLIENT_EXTENSIONS === true
    ? SkipClientExtensionsTransform.transform
    : null,
  FlattenTransform.transformWithOptions({}),
  RelayGenerateTypeNameTransform.transform,
  RelaySkipHandleFieldTransform.transform,
  FilterDirectivesTransform.transform,
  RefineOperationVariablesTransform.transform,
].filter(Boolean);

module.exports = {
  commonTransforms: relayCommonTransforms,
  codegenTransforms: relayCodegenTransforms,
  fragmentTransforms: relayFragmentTransforms,
  printTransforms: relayPrintTransforms,
  queryTransforms: relayQueryTransforms,
  schemaExtensions: relaySchemaExtensions,
};
