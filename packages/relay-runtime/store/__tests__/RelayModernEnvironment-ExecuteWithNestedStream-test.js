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

describe('execute() a query with nested @stream', () => {
  let actorFragment;
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

    ({
      FeedQuery: query,
      FeedFragment: feedFragment,
      ActorFragment: actorFragment,
    } = generateAndCompile(`
        query FeedQuery($enableStream: Boolean!) {
          viewer {
            ...FeedFragment
          }
        }

        fragment FeedFragment on Viewer {
          newsFeed(first: 10) {
            edges  @stream(label: "newsFeed", if: $enableStream, initial_count: 0) {
              cursor
              node {
                id
                feedback {
                  actors @stream(label: "actors", if: $enableStream, initial_count: 0) {
                    name @__clientField(handle: "name_handler")
                  }
                }
              }
            }
          }
        }

        fragment FeedEdgeFragment on NewsFeedEdge {
          cursor
          node {
            id
            feedback {
              actors @stream(label: "actors", if: $enableStream, initial_count: 0) {
                name @__clientField(handle: "name_handler")
              }
            }
          }
        }

        # keep in sync with above
        fragment ActorFragment on Actor {
          name @__clientField(handle: "name_handler")
        }
      `));
    variables = {enableStream: true};
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
        }
      },
    });

    // Publish an initial root payload and a parent nested stream payload
    const initialSnapshot = environment.lookup(selector, operation);
    callback = jest.fn();
    environment.subscribe(initialSnapshot, callback);

    environment.execute({operation}).subscribe(callbacks);
    dataSource.next({
      data: {
        viewer: {
          newsFeed: {
            edges: [],
          },
        },
      },
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
            actors: [],
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
              id: '1',
              feedback: {
                actors: [],
              },
            },
          },
        ],
      },
    });
    callback.mockClear();
    complete.mockClear();
    error.mockClear();
    next.mockClear();
  });

  afterEach(() => {
    RelayFeatureFlags.ENABLE_INCREMENTAL_DELIVERY = previousEnableIncrementalDelivery;
  });

  it('processes nested payloads', () => {
    dataSource.next({
      data: {
        __typename: 'User',
        id: 'user-1',
        name: 'Alice',
      },
      label: 'FeedFragment$stream$actors',
      path: ['viewer', 'newsFeed', 'edges', 0, 'node', 'feedback', 'actors', 0],
    });
    expect(error.mock.calls.map(call => call[0].stack)).toEqual([]);
    expect(next).toBeCalledTimes(1);
    expect(callback).toBeCalledTimes(1);
    const snapshot2 = callback.mock.calls[0][0];
    expect(snapshot2.isMissingData).toBe(false);
    expect(snapshot2.data).toEqual({
      newsFeed: {
        edges: [
          {
            cursor: 'cursor-1',
            node: {
              id: '1',
              feedback: {
                actors: [
                  {
                    name: 'ALICE',
                  },
                ],
              },
            },
          },
        ],
      },
    });

    dataSource.next({
      data: {
        __typename: 'User',
        id: 'user-2',
        name: 'Bob',
      },
      label: 'FeedFragment$stream$actors',
      path: ['viewer', 'newsFeed', 'edges', 0, 'node', 'feedback', 'actors', 1],
    });
    expect(error.mock.calls.map(call => call[0].stack)).toEqual([]);
    expect(next).toBeCalledTimes(2);
    expect(callback).toBeCalledTimes(2);
    const snapshot3 = callback.mock.calls[1][0];
    expect(snapshot3.isMissingData).toBe(false);
    expect(snapshot3.data).toEqual({
      newsFeed: {
        edges: [
          {
            cursor: 'cursor-1',
            node: {
              id: '1',
              feedback: {
                actors: [
                  {
                    name: 'ALICE',
                  },
                  {name: 'BOB'},
                ],
              },
            },
          },
        ],
      },
    });

    expect(complete).toBeCalledTimes(0);
    expect(error).toBeCalledTimes(0);
  });

  it('processes @stream payloads when the parent record has been deleted', () => {
    environment.commitUpdate(proxy => {
      proxy.delete('feedback-1');
    });
    const snapshot = callback.mock.calls[0][0];
    expect(snapshot.isMissingData).toBe(false);
    expect(snapshot.data).toEqual({
      newsFeed: {
        edges: [
          {
            cursor: 'cursor-1',
            node: {
              id: '1',
              feedback: null,
            },
          },
        ],
      },
    });
    callback.mockClear();

    dataSource.next({
      data: {
        __typename: 'User',
        id: 'user-1',
        name: 'Alice',
      },
      label: 'FeedFragment$stream$actors',
      path: ['viewer', 'newsFeed', 'edges', 0, 'node', 'feedback', 'actors', 0],
    });
    expect(next).toBeCalledTimes(1);
    // parent Feedback is not updated
    expect(callback).toBeCalledTimes(0);

    // but the streamed entity is added to the store
    const actorSnapshot = environment.lookup(
      {
        dataID: 'user-1',
        node: actorFragment,
        variables: {},
      },
      operation,
    );
    expect(actorSnapshot.isMissingData).toBe(false);
    expect(actorSnapshot.data).toEqual({
      name: 'ALICE',
    });

    expect(complete).toBeCalledTimes(0);
    expect(error).toBeCalledTimes(0);
  });

  it('processes @stream payloads when the streamed field has been deleted on the parent record', () => {
    environment.commitUpdate(proxy => {
      const feedback = proxy.get('feedback-1');
      if (feedback != null) {
        feedback.setValue(null, 'actors');
      }
    });
    const snapshot = callback.mock.calls[0][0];
    expect(snapshot.isMissingData).toBe(false);
    expect(snapshot.data).toEqual({
      newsFeed: {
        edges: [
          {
            cursor: 'cursor-1',
            node: {
              id: '1',
              feedback: {
                actors: null,
              },
            },
          },
        ],
      },
    });
    callback.mockClear();

    dataSource.next({
      data: {
        __typename: 'User',
        id: 'user-1',
        name: 'Alice',
      },
      label: 'FeedFragment$stream$actors',
      path: ['viewer', 'newsFeed', 'edges', 0, 'node', 'feedback', 'actors', 0],
    });
    expect(next).toBeCalledTimes(1);
    // parent Feedback is not updated
    expect(callback).toBeCalledTimes(0);

    // but the streamed entity is added to the store
    const actorSnapshot = environment.lookup(
      {
        dataID: 'user-1',
        node: actorFragment,
        variables: {},
      },
      operation,
    );
    expect(actorSnapshot.isMissingData).toBe(false);
    expect(actorSnapshot.data).toEqual({
      name: 'ALICE',
    });

    expect(complete).toBeCalledTimes(0);
    expect(error).toBeCalledTimes(0);
  });

  it(
    'processes @stream payloads when the identity of the item at the ' +
      'target index has changed on the parent record ()',
    () => {
      environment.commitUpdate(proxy => {
        const parent = proxy.get('feedback-1');
        const actor = proxy.create('<other>', 'User');
        actor.setValue('Other user', '__name_name_handler');
        if (parent != null) {
          parent.setLinkedRecords([actor], 'actors');
        }
      });
      const snapshot = callback.mock.calls[0][0];
      expect(snapshot.isMissingData).toBe(false);
      expect(snapshot.data).toEqual({
        newsFeed: {
          edges: [
            {
              cursor: 'cursor-1',
              node: {
                id: '1',
                feedback: {
                  actors: [{name: 'Other user'}],
                },
              },
            },
          ],
        },
      });
      callback.mockClear();

      dataSource.next({
        data: {
          __typename: 'User',
          id: 'user-1',
          name: 'Alice',
        },
        label: 'FeedFragment$stream$actors',
        path: [
          'viewer',
          'newsFeed',
          'edges',
          0,
          'node',
          'feedback',
          'actors',
          0,
        ],
      });
      expect(next).toBeCalledTimes(1);
      // parent Feedback is not updated
      expect(callback).toBeCalledTimes(0);

      // but the streamed entity is added to the store
      const actorSnapshot = environment.lookup(
        {
          dataID: 'user-1',
          node: actorFragment,
          variables: {},
        },
        operation,
      );
      expect(actorSnapshot.isMissingData).toBe(false);
      expect(actorSnapshot.data).toEqual({
        name: 'ALICE',
      });

      expect(complete).toBeCalledTimes(0);
      expect(error).toBeCalledTimes(0);
    },
  );

  it(
    'processes @stream payloads when the identity of the item at the ' +
      'an index other than the target has changed on the parent record ()',
    () => {
      environment.commitUpdate(proxy => {
        const parent = proxy.get('feedback-1');
        const actor = proxy.create('<other>', 'User');
        actor.setValue('Other user', '__name_name_handler');
        if (parent != null) {
          parent.setLinkedRecords([actor], 'actors');
        }
      });
      const snapshot = callback.mock.calls[0][0];
      expect(snapshot.isMissingData).toBe(false);
      expect(snapshot.data).toEqual({
        newsFeed: {
          edges: [
            {
              cursor: 'cursor-1',
              node: {
                id: '1',
                feedback: {
                  actors: [{name: 'Other user'}],
                },
              },
            },
          ],
        },
      });
      callback.mockClear();

      dataSource.next({
        data: {
          __typename: 'User',
          id: 'user-2',
          name: 'Bob',
        },
        label: 'FeedFragment$stream$actors',
        path: [
          'viewer',
          'newsFeed',
          'edges',
          0,
          'node',
          'feedback',
          'actors',
          1,
        ],
      });
      expect(next).toBeCalledTimes(1);
      // parent Feedback is not updated
      expect(callback).toBeCalledTimes(0);

      // but the streamed entity is added to the store
      const actorSnapshot = environment.lookup(
        {
          dataID: 'user-2',
          node: actorFragment,
          variables: {},
        },
        operation,
      );
      expect(actorSnapshot.isMissingData).toBe(false);
      expect(actorSnapshot.data).toEqual({
        name: 'BOB',
      });

      expect(complete).toBeCalledTimes(0);
      expect(error).toBeCalledTimes(0);
    },
  );

  it('processes streamed payloads that arrive out of order', () => {
    // return index 1 before index 0
    dataSource.next({
      data: {
        __typename: 'User',
        id: 'user-2',
        name: 'Bob',
      },
      label: 'FeedFragment$stream$actors',
      path: ['viewer', 'newsFeed', 'edges', 0, 'node', 'feedback', 'actors', 1],
    });
    dataSource.next({
      data: {
        __typename: 'User',
        id: 'user-1',
        name: 'Alice',
      },
      label: 'FeedFragment$stream$actors',
      path: ['viewer', 'newsFeed', 'edges', 0, 'node', 'feedback', 'actors', 0],
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
              id: '1',
              feedback: {
                actors: [
                  {
                    name: 'ALICE',
                  },
                  {name: 'BOB'},
                ],
              },
            },
          },
        ],
      },
    });

    expect(complete).toBeCalledTimes(0);
    expect(error).toBeCalledTimes(0);
  });

  it('processes streamed payloads relative to the most recent root payload', () => {
    dataSource.next({
      data: {
        cursor: 'cursor-1',
        node: {
          __typename: 'Story',
          id: '1',
          feedback: {
            id: 'feedback-2',
            actors: [],
          },
        },
      },
      label: 'FeedFragment$stream$newsFeed',
      path: ['viewer', 'newsFeed', 'edges', 0],
    });
    next.mockClear();
    callback.mockClear();

    dataSource.next({
      data: {
        __typename: 'User',
        id: 'user-1',
        name: 'Alice',
      },
      label: 'FeedFragment$stream$actors',
      path: ['viewer', 'newsFeed', 'edges', 0, 'node', 'feedback', 'actors', 0],
    });

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
              id: '1',
              feedback: {
                actors: [{name: 'ALICE'}],
              },
            },
          },
        ],
      },
    });
  });

  it('calls error() for invalid streamed payloads (unknown label)', () => {
    dataSource.next({
      data: {
        __typename: 'User',
        id: 'user-1',
        name: 'Alice',
      },
      label: '<unknown-label>',
      path: ['viewer', 'newsFeed', 'edges', 0, 'node', 'feedback', 'actors', 0],
    });

    expect(complete).toBeCalledTimes(0);
    expect(error).toBeCalledTimes(1);
    expect(error.mock.calls[0][0].message).toContain(
      "RelayModernEnvironment: Received response for unknown label '<unknown-label>'",
    );
    expect(next).toBeCalledTimes(0);
    expect(callback).toBeCalledTimes(0);
  });

  it('calls error() for invalid streamed payloads (unknown path)', () => {
    dataSource.next({
      data: {
        __typename: 'User',
        id: 'user-1',
        name: 'Alice',
      },
      label: 'FeedFragment$stream$actors',
      path: [
        '<unknown-path>',
        'viewer',
        'newsFeed',
        'edges',
        0,
        'node',
        'feedback',
        'actors',
        0,
      ],
    });

    expect(complete).toBeCalledTimes(0);
    expect(error).toBeCalledTimes(1);
    expect(error.mock.calls[0][0].message).toContain(
      'RelayModernEnvironment: Received response for unknown path ' +
        '`<unknown-path>.viewer.newsFeed.edges.0.node.feedback` for label ' +
        '`FeedFragment$stream$actors`. Known paths: ' +
        'viewer.newsFeed.edges.0.node.feedback.',
    );
    expect(next).toBeCalledTimes(0);
    expect(callback).toBeCalledTimes(0);
  });

  it('calls complete() when server completes', () => {
    dataSource.complete();
    expect(complete).toBeCalledTimes(1);
    expect(error).toBeCalledTimes(0);
    expect(next).toBeCalledTimes(0);
  });

  it('calls error() when server errors', () => {
    const err = new Error('wtf');
    dataSource.error(err);
    expect(complete).toBeCalledTimes(0);
    expect(error).toBeCalledTimes(1);
    expect(error.mock.calls[0][0]).toBe(err);
  });

  it('calls error() when streamed payload is missing data', () => {
    dataSource.next({
      errors: [
        {
          message: 'wtf',
          locations: [],
          severity: 'ERROR',
        },
      ],
      label: 'FeedFragment$stream$actors',
      path: [
        '<unknown-path>',
        'viewer',
        'newsFeed',
        'edges',
        0,
        'node',
        'feedback',
        'actors',
        0,
      ],
    });

    expect(complete).toBeCalledTimes(0);
    expect(error).toBeCalledTimes(1);
    expect(error.mock.calls[0][0].message).toContain(
      'No data returned for operation `FeedQuery`',
    );
    expect(next).toBeCalledTimes(0);
    expect(callback).toBeCalledTimes(0);
  });
});
