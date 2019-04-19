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

const RelayFeatureFlags = require('../../util/RelayFeatureFlags');
const RelayInMemoryRecordSource = require('../RelayInMemoryRecordSource');
const RelayModernEnvironment = require('../RelayModernEnvironment');
const RelayModernOperationDescriptor = require('../RelayModernOperationDescriptor');
const RelayModernStore = require('../RelayModernStore');
const RelayNetwork = require('../../network/RelayNetwork');

const {ROOT_ID} = require('../RelayStoreUtils');
const {generateAndCompile, matchers} = require('@vincentriemer/relay-test-utils');

function createOperationDescriptor(...args) {
  const operation = RelayModernOperationDescriptor.createOperationDescriptor(
    ...args,
  );
  // For convenience of the test output, override toJSON to print
  // a more succint description of the operation.
  // $FlowFixMe
  operation.toJSON = () => {
    return {
      name: operation.fragment.node.name,
      variables: operation.variables,
    };
  };
  return operation;
}

describe('execute() with Promise network', () => {
  let callbacks;
  let complete;
  let deferred;
  let environment;
  let error;
  let fetch;
  let next;
  let operation;
  let previousEnableIncrementalDelivery;
  let query;
  let source;
  let store;
  let variables;

  beforeEach(() => {
    jest.resetModules();
    previousEnableIncrementalDelivery =
      RelayFeatureFlags.ENABLE_INCREMENTAL_DELIVERY;
    RelayFeatureFlags.ENABLE_INCREMENTAL_DELIVERY = true;

    expect.extend(matchers);
    ({ActorQuery: query} = generateAndCompile(`
        query ActorQuery($fetchSize: Boolean!) {
          me {
            name
            profilePicture(size: 42) @include(if: $fetchSize) {
              uri
            }
          }
        }
      `));
    variables = {fetchSize: false};
    operation = createOperationDescriptor(query, {
      ...variables,
      foo: 'bar', // should be filtered from network fetch
    });

    complete = jest.fn();
    error = jest.fn();
    next = jest.fn();
    callbacks = {complete, error, next};
    fetch = jest.fn(
      () =>
        new Promise((resolve, reject) => {
          deferred = {resolve, reject};
        }),
    );
    source = new RelayInMemoryRecordSource();
    store = new RelayModernStore(source);
    environment = new RelayModernEnvironment({
      network: RelayNetwork.create((fetch: $FlowFixMe)),
      store,
    });
  });

  afterEach(() => {
    RelayFeatureFlags.ENABLE_INCREMENTAL_DELIVERY = previousEnableIncrementalDelivery;
  });

  it('fetches queries', () => {
    environment.execute({operation}).subscribe(callbacks);
    expect(fetch.mock.calls.length).toBe(1);
    expect(fetch.mock.calls[0][0]).toEqual(query.params);
    expect(fetch.mock.calls[0][1]).toEqual({fetchSize: false});
    expect(fetch.mock.calls[0][2]).toEqual({});
  });

  it('fetches queries with force:true', () => {
    const cacheConfig = {force: true};
    environment.execute({cacheConfig, operation}).subscribe(callbacks);
    expect(fetch.mock.calls.length).toBe(1);
    expect(fetch.mock.calls[0][0]).toEqual(query.params);
    expect(fetch.mock.calls[0][1]).toEqual({fetchSize: false});
    expect(fetch.mock.calls[0][2]).toBe(cacheConfig);
  });

  it('calls complete() when the batch completes', () => {
    environment.execute({operation}).subscribe(callbacks);
    deferred.resolve({
      data: {
        me: {
          id: '842472',
          __typename: 'User',
          name: 'Joe',
        },
      },
    });
    jest.runAllTimers();
    expect(complete.mock.calls.length).toBe(1);
    expect(next.mock.calls.length).toBe(1);
    expect(error).not.toBeCalled();
  });

  it('calls error() when the batch has an error', () => {
    environment.execute({operation}).subscribe(callbacks);
    const e = new Error('wtf');
    deferred.reject(e);
    jest.runAllTimers();

    expect(error).toBeCalledWith(e);
    expect(complete).not.toBeCalled();
    expect(next.mock.calls.length).toBe(0);
  });

  it('calls next() and publishes payloads to the store', () => {
    const selector = {
      dataID: ROOT_ID,
      node: query.fragment,
      variables,
    };
    const snapshot = environment.lookup(selector, operation);
    const callback = jest.fn();
    environment.subscribe(snapshot, callback);

    environment.execute({operation}).subscribe(callbacks);
    const payload = {
      data: {
        me: {
          id: '842472',
          __typename: 'User',
          name: 'Joe',
        },
      },
      errors: undefined,
    };
    deferred.resolve(payload);
    jest.runAllTimers();

    expect(next.mock.calls.length).toBe(1);
    expect(next).toBeCalledWith(payload);
    expect(complete).toBeCalled();
    expect(error).not.toBeCalled();
    expect(callback.mock.calls.length).toBe(1);
    expect(callback.mock.calls[0][0].data).toEqual({
      me: {
        name: 'Joe',
      },
    });
  });
});
