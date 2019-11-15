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

const EntryPointContainer = require('./relay-experimental/EntryPointContainer.react');
const LazyLoadEntryPointContainer = require('./relay-experimental/LazyLoadEntryPointContainer.react');
const MatchContainer = require('./relay-experimental/MatchContainer');
const ProfilerContext = require('./relay-experimental/ProfilerContext');
const RelayEnvironmentProvider = require('./relay-experimental/RelayEnvironmentProvider');

const fetchQuery = require('./relay-experimental/fetchQuery');
const preloadQuery = require('./relay-experimental/preloadQuery');
const prepareEntryPoint = require('./relay-experimental/prepareEntryPoint');
const useBlockingPaginationFragment = require('./relay-experimental/useBlockingPaginationFragment');
const useFragment = require('./relay-experimental/useFragment');
const useLazyLoadQuery = require('./relay-experimental/useLazyLoadQuery');
const useLegacyPaginationFragment = require('./relay-experimental/useLegacyPaginationFragment');
const usePreloadedQuery = require('./relay-experimental/usePreloadedQuery');
const useRefetchableFragment = require('./relay-experimental/useRefetchableFragment');
const useRelayEnvironment = require('./relay-experimental/useRelayEnvironment');

const {graphql} = require('relay-runtime');

export type {
  FetchPolicy,
  LoadMoreFn,
  RefetchFn,
  RefetchFnDynamic,
} from 'relay-experimental';

/**
 * The public interface for Relay Hooks
 */
module.exports = {
  EntryPointContainer: EntryPointContainer,
  LazyLoadEntryPointContainer: LazyLoadEntryPointContainer,
  MatchContainer: MatchContainer,
  ProfilerContext: ProfilerContext,
  RelayEnvironmentProvider: RelayEnvironmentProvider,

  fetchQuery: fetchQuery,
  preloadQuery: preloadQuery,
  prepareEntryPoint: prepareEntryPoint,

  graphql: graphql,
  useBlockingPaginationFragment: useBlockingPaginationFragment,
  useFragment: useFragment,
  useLazyLoadQuery: useLazyLoadQuery,
  usePaginationFragment: useLegacyPaginationFragment,
  usePreloadedQuery: usePreloadedQuery,
  useRefetchableFragment: useRefetchableFragment,
  useRelayEnvironment: useRelayEnvironment,
};
