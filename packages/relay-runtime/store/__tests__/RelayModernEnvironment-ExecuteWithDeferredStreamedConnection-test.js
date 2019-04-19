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

const RelayConnectionHandler = require('../../handlers/connection/RelayConnectionHandler');
const RelayFeatureFlags = require('../../util/RelayFeatureFlags');
const RelayInMemoryRecordSource = require('../RelayInMemoryRecordSource');
const RelayModernEnvironment = require('../RelayModernEnvironment');
const RelayModernOperationDescriptor = require('../RelayModernOperationDescriptor');
const RelayModernStore = require('../RelayModernStore');
const RelayNetwork = require('../../network/RelayNetwork');
const RelayObservable = require('../../network/RelayObservable');
const RelayViewerHandler = require('../../handlers/viewer/RelayViewerHandler');

const {generateAndCompile, matchers} = require('@vincentriemer/relay-test-utils');

const {VIEWER_ID} = RelayViewerHandler;

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

describe('execute() fetches a @defer-ed @stream-ed @connection', () => {
  let callback;
  let callbacks;
  let complete;
  let dataSource;
  let environment;
  let error;
  let feedFragment;
  let fetch;
  let next;
  let operation;
  let previousEnableIncrementalDelivery;
  let query;
  let selector;
  let source;
  let store;
  let variables;

  beforeEach(() => {
    jest.resetModules();
    jest.mock('warning');
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    previousEnableIncrementalDelivery =
      RelayFeatureFlags.ENABLE_INCREMENTAL_DELIVERY;
    RelayFeatureFlags.ENABLE_INCREMENTAL_DELIVERY = true;

    expect.extend(matchers);

    ({FeedQuery: query, FeedFragment: feedFragment} = generateAndCompile(`
        query FeedQuery($enableStream: Boolean!, $after: ID) {
          viewer {
            __typename
            ...FeedFragment @defer(label: "FeedFragment")
          }
        }

        fragment FeedFragment on Viewer {
          newsFeed(first: 10, after: $after)
          @connection(key: "RelayModernEnvironment_newsFeed") {
            edges
            @stream(label: "newsFeed", if: $enableStream, initial_count: 0) {
              cursor
              node {
                __typename
                id
                feedback {
                  id
                  actors {
                    id
                    name @__clientField(handle: "name_handler")
                  }
                }
              }
            }
            pageInfo {
              endCursor
              hasNextPage
            }
          }
        }

        fragment FeedEdgeFragment on NewsFeedEdge {
          cursor
          node {
            id
            feedback {
              id
            }
          }
        }
      `));
    variables = {enableStream: true, after: null};
    operation = createOperationDescriptor(query, variables);
    selector = {
      dataID: VIEWER_ID,
      node: feedFragment,
      variables,
    };

    const NameHandler = {
      update(storeProxy, payload) {
        const record = storeProxy.get(payload.dataID);
        if (record != null) {
          const markup = record.getValue(payload.fieldKey);
          record.setValue(
            typeof markup === 'string' ? markup.toUpperCase() : null,
            payload.handleKey,
          );
        }
      },
    };

    complete = jest.fn();
    error = jest.fn();
    next = jest.fn();
    callbacks = {complete, error, next};
    fetch = (_query, _variables, _cacheConfig) => {
      return RelayObservable.create(sink => {
        dataSource = sink;
      });
    };
    source = new RelayInMemoryRecordSource();
    store = new RelayModernStore(source);
    environment = new RelayModernEnvironment({
      network: RelayNetwork.create(fetch),
      store,
      handlerProvider: name => {
        switch (name) {
          case 'name_handler':
            return NameHandler;
          case 'viewer':
            return RelayViewerHandler;
          case 'connection':
            return RelayConnectionHandler;
        }
      },
    });
  });

  afterEach(() => {
    RelayFeatureFlags.ENABLE_INCREMENTAL_DELIVERY = previousEnableIncrementalDelivery;
  });

  it('does not initialize the connection with the root payload', () => {
    const initialSnapshot = environment.lookup(selector);
    callback = jest.fn();
    environment.subscribe(initialSnapshot, callback);

    environment.execute({operation}).subscribe(callbacks);
    dataSource.next({
      data: {
        viewer: {
          __typename: 'Viewer',
        },
      },
    });

    expect(next).toBeCalledTimes(1);
    expect(callback).toBeCalledTimes(1);
    const snapshot = callback.mock.calls[0][0];
    expect(snapshot.isMissingData).toBe(true);
    expect(snapshot.data).toEqual({
      newsFeed: undefined,
    });
  });

  it('initializes the connection with the deferred payload', () => {
    const initialSnapshot = environment.lookup(selector);
    callback = jest.fn();
    environment.subscribe(initialSnapshot, callback);

    environment.execute({operation}).subscribe(callbacks);
    dataSource.next({
      data: {
        viewer: {
          __typename: 'Viewer',
        },
      },
    });
    jest.runAllTimers();
    next.mockClear();
    callback.mockClear();

    dataSource.next({
      data: {
        newsFeed: {
          edges: [],
        },
      },
      label: 'FeedQuery$defer$FeedFragment',
      path: ['viewer'],
    });
    expect(next).toBeCalledTimes(1);
    expect(callback).toBeCalledTimes(1);
    const snapshot = callback.mock.calls[0][0];
    expect(snapshot.isMissingData).toBe(false);
    expect(snapshot.data).toEqual({
      newsFeed: {
        edges: [],
        pageInfo: {
          endCursor: null,
          hasNextPage: false,
        },
      },
    });
  });

  it('initializes the connection with the first edge (0 => 1 edges)', () => {
    const initialSnapshot = environment.lookup(selector);
    callback = jest.fn();
    environment.subscribe(initialSnapshot, callback);

    environment.execute({operation}).subscribe(callbacks);
    dataSource.next({
      data: {
        viewer: {
          __typename: 'Viewer',
        },
      },
    });
    dataSource.next({
      data: {
        newsFeed: {
          edges: [],
        },
      },
      label: 'FeedQuery$defer$FeedFragment',
      path: ['viewer'],
    });
    jest.runAllTimers();
    next.mockClear();
    callback.mockClear();

    dataSource.next({
      data: {
        cursor: 'cursor-1',
        node: {
          __typename: 'Story',
          id: '1',
          feedback: {
            id: 'feedback-1',
            actors: [
              {
                id: 'actor-1',
                __typename: 'User',
                name: 'Alice',
              },
            ],
          },
        },
      },
      label: 'FeedFragment$stream$newsFeed',
      path: ['viewer', 'newsFeed', 'edges', 0],
    });
    expect(error.mock.calls.map(call => call[0].stack)).toEqual([]);
    expect(next).toBeCalledTimes(1);
    expect(callback).toBeCalledTimes(1);
    const snapshot = callback.mock.calls[0][0];
    expect(snapshot.isMissingData).toBe(false);
    expect(snapshot.data).toEqual({
      newsFeed: {
        edges: [
          {
            cursor: 'cursor-1',
            node: {
              __typename: 'Story',
              id: '1',
              feedback: {
                id: 'feedback-1',
                actors: [{id: 'actor-1', name: 'ALICE'}],
              },
            },
          },
        ],
        pageInfo: {
          endCursor: null,
          hasNextPage: false,
        },
      },
    });
  });

  it('initializes the connection with subsequent edges (1 => 2 edges)', () => {
    const initialSnapshot = environment.lookup(selector);
    callback = jest.fn();
    environment.subscribe(initialSnapshot, callback);

    environment.execute({operation}).subscribe(callbacks);
    dataSource.next({
      data: {
        viewer: {
          __typename: 'Viewer',
        },
      },
    });
    dataSource.next({
      data: {
        newsFeed: {
          edges: [],
        },
      },
      label: 'FeedQuery$defer$FeedFragment',
      path: ['viewer'],
    });
    jest.runAllTimers();
    next.mockClear();
    callback.mockClear();

    // first edge
    dataSource.next({
      data: {
        cursor: 'cursor-1',
        node: {
          __typename: 'Story',
          id: '1',
          feedback: {
            id: 'feedback-1',
            actors: [
              {
                id: 'actor-1',
                __typename: 'User',
                name: 'Alice',
              },
            ],
          },
        },
      },
      label: 'FeedFragment$stream$newsFeed',
      path: ['viewer', 'newsFeed', 'edges', 0],
    });
    // second edge should be appended, not replace first edge
    dataSource.next({
      data: {
        cursor: 'cursor-2',
        node: {
          __typename: 'Story',
          id: '2',
          feedback: {
            id: 'feedback-2',
            actors: [
              {
                id: 'actor-2',
                __typename: 'User',
                name: 'Bob',
              },
            ],
          },
        },
      },
      label: 'FeedFragment$stream$newsFeed',
      path: ['viewer', 'newsFeed', 'edges', 1],
    });
    expect(error.mock.calls.map(call => call[0].stack)).toEqual([]);
    expect(next).toBeCalledTimes(2);
    expect(callback).toBeCalledTimes(2);
    const snapshot = callback.mock.calls[1][0];
    expect(snapshot.isMissingData).toBe(false);
    expect(snapshot.data).toEqual({
      newsFeed: {
        edges: [
          {
            cursor: 'cursor-1',
            node: {
              __typename: 'Story',
              id: '1',
              feedback: {
                id: 'feedback-1',
                actors: [{id: 'actor-1', name: 'ALICE'}],
              },
            },
          },
          {
            cursor: 'cursor-2',
            node: {
              __typename: 'Story',
              id: '2',
              feedback: {
                id: 'feedback-2',
                actors: [{id: 'actor-2', name: 'BOB'}],
              },
            },
          },
        ],
        pageInfo: {
          endCursor: null,
          hasNextPage: false,
        },
      },
    });
  });

  it('initializes the connection with subsequent edges (1 => 2 edges) when initial_count=1', () => {
    const initialSnapshot = environment.lookup(selector);
    callback = jest.fn();
    environment.subscribe(initialSnapshot, callback);

    environment.execute({operation}).subscribe(callbacks);
    dataSource.next({
      data: {
        viewer: {
          __typename: 'Viewer',
        },
      },
    });
    dataSource.next({
      data: {
        newsFeed: {
          edges: [
            {
              cursor: 'cursor-1',
              node: {
                __typename: 'Story',
                id: '1',
                feedback: {
                  id: 'feedback-1',
                  actors: [
                    {
                      id: 'actor-1',
                      __typename: 'User',
                      name: 'Alice',
                    },
                  ],
                },
              },
            },
          ],
        },
      },
      label: 'FeedQuery$defer$FeedFragment',
      path: ['viewer'],
    });
    jest.runAllTimers();
    next.mockClear();
    callback.mockClear();

    // second edge should be appended, not replace first edge
    dataSource.next({
      data: {
        cursor: 'cursor-2',
        node: {
          __typename: 'Story',
          id: '2',
          feedback: {
            id: 'feedback-2',
            actors: [
              {
                id: 'actor-2',
                __typename: 'User',
                name: 'Bob',
              },
            ],
          },
        },
      },
      label: 'FeedFragment$stream$newsFeed',
      path: ['viewer', 'newsFeed', 'edges', 1],
    });
    expect(error.mock.calls.map(call => call[0].stack)).toEqual([]);
    expect(next).toBeCalledTimes(1);
    expect(callback).toBeCalledTimes(1);
    const snapshot = callback.mock.calls[0][0];
    expect(snapshot.isMissingData).toBe(false);
    expect(snapshot.data).toEqual({
      newsFeed: {
        edges: [
          {
            cursor: 'cursor-1',
            node: {
              __typename: 'Story',
              id: '1',
              feedback: {
                id: 'feedback-1',
                actors: [{id: 'actor-1', name: 'ALICE'}],
              },
            },
          },
          {
            cursor: 'cursor-2',
            node: {
              __typename: 'Story',
              id: '2',
              feedback: {
                id: 'feedback-2',
                actors: [{id: 'actor-2', name: 'BOB'}],
              },
            },
          },
        ],
        pageInfo: {
          endCursor: null,
          hasNextPage: false,
        },
      },
    });
  });
});
