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

const CompilerContext = require('../../core/GraphQLCompilerContext');
const IRTransformer = require('../../core/GraphQLIRTransformer');

const {getRawType} = require('../../core/GraphQLSchemaUtils');
const {GraphQLObjectType} = require('graphql');
const {DEFAULT_HANDLE_KEY} = require('@vincentriemer/relay-runtime');

import type {LinkedField} from '../../core/GraphQLIR';

const ID = 'id';
const VIEWER_HANDLE = 'viewer';
const VIEWER_TYPE = 'Viewer';

/**
 * A transform that adds a "viewer" handle to all fields whose type is `Viewer`.
 */
function relayViewerHandleTransform(context: CompilerContext): CompilerContext {
  const viewerType = context.serverSchema.getType(VIEWER_TYPE);
  if (
    viewerType == null ||
    !(viewerType instanceof GraphQLObjectType) ||
    viewerType.getFields()[ID] != null
  ) {
    return context;
  }
  return IRTransformer.transform(context, {
    LinkedField: visitLinkedField,
  });
}

function visitLinkedField(field: LinkedField): ?LinkedField {
  const transformedNode = this.traverse(field);
  if (getRawType(field.type).name !== VIEWER_TYPE) {
    return transformedNode;
  }
  // In case a viewer field has arguments, we shouldn't give it a global
  // identity. This only applies if the name is 'viewer' because a mutation
  // field might also be the Viewer type.
  if (field.args.length > 0 && field.name === 'viewer') {
    return transformedNode;
  }
  let handles = transformedNode.handles;
  const viewerHandle = {
    name: VIEWER_HANDLE,
    key: DEFAULT_HANDLE_KEY,
    filters: null,
  };

  if (handles && !handles.find(handle => handle.name === VIEWER_HANDLE)) {
    handles = [...handles, viewerHandle];
  } else if (!handles) {
    handles = [viewerHandle];
  }
  return handles !== transformedNode.handles
    ? {...transformedNode, handles}
    : transformedNode;
}

module.exports = {
  transform: relayViewerHandleTransform,
};
