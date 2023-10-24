import {describe, it, expect} from "vitest";
import {ErrorAborted} from "@lodestar/utils";
import {FetchError} from "@lodestar/api";
import {ExecutionPayloadStatus, ExecutionEngineState} from "../../../../src/execution/index.js";
import {
  HTTP_CONNECTION_ERROR_CODES,
  HTTP_FATAL_ERROR_CODES,
  getExecutionEngineState,
} from "../../../../src/execution/engine/utils.js";
import {QueueError, QueueErrorCode} from "../../../../src/util/queue/errors.js";
import {ErrorJsonRpcResponse, HttpRpcError} from "../../../../src/eth1/provider/jsonRpcHttpClient.js";

describe("execution / engine / utils", () => {
  describe("getExecutionEngineState", () => {
    const testCasesPayload: Record<
      ExecutionPayloadStatus,
      [oldState: ExecutionEngineState, newState: ExecutionEngineState][]
    > = {
      [ExecutionPayloadStatus.ACCEPTED]: [
        [ExecutionEngineState.ONLINE, ExecutionEngineState.SYNCED],
        [ExecutionEngineState.AUTH_FAILED, ExecutionEngineState.SYNCED],
        [ExecutionEngineState.OFFLINE, ExecutionEngineState.SYNCED],
        [ExecutionEngineState.SYNCED, ExecutionEngineState.SYNCED],
        [ExecutionEngineState.SYNCING, ExecutionEngineState.SYNCED],
      ],
      [ExecutionPayloadStatus.VALID]: [
        [ExecutionEngineState.ONLINE, ExecutionEngineState.SYNCED],
        [ExecutionEngineState.AUTH_FAILED, ExecutionEngineState.SYNCED],
        [ExecutionEngineState.OFFLINE, ExecutionEngineState.SYNCED],
        [ExecutionEngineState.SYNCED, ExecutionEngineState.SYNCED],
        [ExecutionEngineState.SYNCING, ExecutionEngineState.SYNCED],
      ],
      [ExecutionPayloadStatus.UNSAFE_OPTIMISTIC_STATUS]: [
        [ExecutionEngineState.ONLINE, ExecutionEngineState.SYNCED],
        [ExecutionEngineState.AUTH_FAILED, ExecutionEngineState.SYNCED],
        [ExecutionEngineState.OFFLINE, ExecutionEngineState.SYNCED],
        [ExecutionEngineState.SYNCED, ExecutionEngineState.SYNCED],
        [ExecutionEngineState.SYNCING, ExecutionEngineState.SYNCED],
      ],
      [ExecutionPayloadStatus.ELERROR]: [
        [ExecutionEngineState.ONLINE, ExecutionEngineState.SYNCING],
        [ExecutionEngineState.AUTH_FAILED, ExecutionEngineState.SYNCING],
        [ExecutionEngineState.OFFLINE, ExecutionEngineState.SYNCING],
        [ExecutionEngineState.SYNCED, ExecutionEngineState.SYNCING],
        [ExecutionEngineState.SYNCING, ExecutionEngineState.SYNCING],
      ],
      [ExecutionPayloadStatus.INVALID]: [
        [ExecutionEngineState.ONLINE, ExecutionEngineState.SYNCING],
        [ExecutionEngineState.AUTH_FAILED, ExecutionEngineState.SYNCING],
        [ExecutionEngineState.OFFLINE, ExecutionEngineState.SYNCING],
        [ExecutionEngineState.SYNCED, ExecutionEngineState.SYNCING],
        [ExecutionEngineState.SYNCING, ExecutionEngineState.SYNCING],
      ],
      [ExecutionPayloadStatus.SYNCING]: [
        [ExecutionEngineState.ONLINE, ExecutionEngineState.SYNCING],
        [ExecutionEngineState.AUTH_FAILED, ExecutionEngineState.SYNCING],
        [ExecutionEngineState.OFFLINE, ExecutionEngineState.SYNCING],
        [ExecutionEngineState.SYNCED, ExecutionEngineState.SYNCING],
        [ExecutionEngineState.SYNCING, ExecutionEngineState.SYNCING],
      ],
      [ExecutionPayloadStatus.INVALID_BLOCK_HASH]: [
        [ExecutionEngineState.ONLINE, ExecutionEngineState.SYNCING],
        [ExecutionEngineState.AUTH_FAILED, ExecutionEngineState.SYNCING],
        [ExecutionEngineState.OFFLINE, ExecutionEngineState.SYNCING],
        [ExecutionEngineState.SYNCED, ExecutionEngineState.SYNCING],
        [ExecutionEngineState.SYNCING, ExecutionEngineState.SYNCING],
      ],
      [ExecutionPayloadStatus.UNAVAILABLE]: [
        [ExecutionEngineState.ONLINE, ExecutionEngineState.OFFLINE],
        [ExecutionEngineState.AUTH_FAILED, ExecutionEngineState.OFFLINE],
        [ExecutionEngineState.OFFLINE, ExecutionEngineState.OFFLINE],
        [ExecutionEngineState.SYNCED, ExecutionEngineState.OFFLINE],
        [ExecutionEngineState.SYNCING, ExecutionEngineState.OFFLINE],
      ],
      ["unknown" as ExecutionPayloadStatus]: [
        [ExecutionEngineState.ONLINE, ExecutionEngineState.ONLINE],
        [ExecutionEngineState.AUTH_FAILED, ExecutionEngineState.ONLINE],
        [ExecutionEngineState.OFFLINE, ExecutionEngineState.ONLINE],
        [ExecutionEngineState.SYNCED, ExecutionEngineState.SYNCED],
        [ExecutionEngineState.SYNCING, ExecutionEngineState.SYNCING],
      ],
    };

    type ErrorTestCase = [string, Error, [oldState: ExecutionEngineState, newState: ExecutionEngineState][]];
    const testCasesError: ErrorTestCase[] = [
      [
        "abort error",
        new ErrorAborted(),
        [
          [ExecutionEngineState.ONLINE, ExecutionEngineState.ONLINE],
          [ExecutionEngineState.AUTH_FAILED, ExecutionEngineState.AUTH_FAILED],
          [ExecutionEngineState.OFFLINE, ExecutionEngineState.OFFLINE],
          [ExecutionEngineState.SYNCED, ExecutionEngineState.SYNCED],
          [ExecutionEngineState.SYNCING, ExecutionEngineState.SYNCING],
        ],
      ],
      [
        "queue aborted error",
        new QueueError({code: QueueErrorCode.QUEUE_ABORTED}),
        [
          [ExecutionEngineState.ONLINE, ExecutionEngineState.ONLINE],
          [ExecutionEngineState.AUTH_FAILED, ExecutionEngineState.AUTH_FAILED],
          [ExecutionEngineState.OFFLINE, ExecutionEngineState.OFFLINE],
          [ExecutionEngineState.SYNCED, ExecutionEngineState.SYNCED],
          [ExecutionEngineState.SYNCING, ExecutionEngineState.SYNCING],
        ],
      ],
      [
        "rpc error",
        new HttpRpcError(12, "error"),
        [
          [ExecutionEngineState.ONLINE, ExecutionEngineState.SYNCING],
          [ExecutionEngineState.AUTH_FAILED, ExecutionEngineState.SYNCING],
          [ExecutionEngineState.OFFLINE, ExecutionEngineState.SYNCING],
          [ExecutionEngineState.SYNCED, ExecutionEngineState.SYNCING],
          [ExecutionEngineState.SYNCING, ExecutionEngineState.SYNCING],
        ],
      ],
      [
        "rpc response error",
        new ErrorJsonRpcResponse({jsonrpc: "2.0", id: 123, error: {code: 123, message: "error"}}, "error"),
        [
          [ExecutionEngineState.ONLINE, ExecutionEngineState.SYNCING],
          [ExecutionEngineState.AUTH_FAILED, ExecutionEngineState.SYNCING],
          [ExecutionEngineState.OFFLINE, ExecutionEngineState.SYNCING],
          [ExecutionEngineState.SYNCED, ExecutionEngineState.SYNCING],
          [ExecutionEngineState.SYNCING, ExecutionEngineState.SYNCING],
        ],
      ],
      ...HTTP_FATAL_ERROR_CODES.map((code) => {
        const error = new FetchError("http://localhost:1234", new TypeError("error"));
        error.code = code;

        return [
          `http error with code '${code}'`,
          error,
          [
            [ExecutionEngineState.ONLINE, ExecutionEngineState.OFFLINE],
            [ExecutionEngineState.AUTH_FAILED, ExecutionEngineState.OFFLINE],
            [ExecutionEngineState.OFFLINE, ExecutionEngineState.OFFLINE],
            [ExecutionEngineState.SYNCED, ExecutionEngineState.OFFLINE],
            [ExecutionEngineState.SYNCING, ExecutionEngineState.OFFLINE],
          ],
        ] as ErrorTestCase;
      }),
      ...HTTP_CONNECTION_ERROR_CODES.map((code) => {
        const error = new FetchError("http://localhost:1234", new TypeError("error"));
        error.code = code;

        return [
          `http error with code '${code}'`,
          error,
          [
            [ExecutionEngineState.ONLINE, ExecutionEngineState.AUTH_FAILED],
            [ExecutionEngineState.AUTH_FAILED, ExecutionEngineState.AUTH_FAILED],
            [ExecutionEngineState.OFFLINE, ExecutionEngineState.AUTH_FAILED],
            [ExecutionEngineState.SYNCED, ExecutionEngineState.AUTH_FAILED],
            [ExecutionEngineState.SYNCING, ExecutionEngineState.AUTH_FAILED],
          ],
        ] as ErrorTestCase;
      }),
      [
        "unknown error",
        new Error("unknown error"),
        [
          [ExecutionEngineState.ONLINE, ExecutionEngineState.ONLINE],
          [ExecutionEngineState.AUTH_FAILED, ExecutionEngineState.AUTH_FAILED],
          [ExecutionEngineState.OFFLINE, ExecutionEngineState.OFFLINE],
          [ExecutionEngineState.SYNCED, ExecutionEngineState.SYNCED],
          [ExecutionEngineState.SYNCING, ExecutionEngineState.SYNCING],
        ],
      ],
    ];

    const testCasesTargetState: Record<
      ExecutionEngineState,
      [oldState: ExecutionEngineState, newState: ExecutionEngineState][]
    > = {
      [ExecutionEngineState.ONLINE]: [
        [ExecutionEngineState.ONLINE, ExecutionEngineState.ONLINE],
        [ExecutionEngineState.AUTH_FAILED, ExecutionEngineState.ONLINE],
        [ExecutionEngineState.OFFLINE, ExecutionEngineState.ONLINE],
        // Once start syncing it should not go back to online state
        // Online is an initial state when execution engine is created
        [ExecutionEngineState.SYNCED, ExecutionEngineState.SYNCED],
        [ExecutionEngineState.SYNCING, ExecutionEngineState.SYNCING],
      ],
      [ExecutionEngineState.AUTH_FAILED]: [
        [ExecutionEngineState.ONLINE, ExecutionEngineState.AUTH_FAILED],
        [ExecutionEngineState.AUTH_FAILED, ExecutionEngineState.AUTH_FAILED],
        [ExecutionEngineState.OFFLINE, ExecutionEngineState.AUTH_FAILED],
        [ExecutionEngineState.SYNCED, ExecutionEngineState.AUTH_FAILED],
        [ExecutionEngineState.SYNCING, ExecutionEngineState.AUTH_FAILED],
      ],
      [ExecutionEngineState.OFFLINE]: [
        [ExecutionEngineState.ONLINE, ExecutionEngineState.OFFLINE],
        [ExecutionEngineState.AUTH_FAILED, ExecutionEngineState.OFFLINE],
        [ExecutionEngineState.OFFLINE, ExecutionEngineState.OFFLINE],
        [ExecutionEngineState.SYNCED, ExecutionEngineState.OFFLINE],
        [ExecutionEngineState.SYNCING, ExecutionEngineState.OFFLINE],
      ],
      [ExecutionEngineState.SYNCED]: [
        [ExecutionEngineState.ONLINE, ExecutionEngineState.SYNCED],
        [ExecutionEngineState.AUTH_FAILED, ExecutionEngineState.SYNCED],
        [ExecutionEngineState.OFFLINE, ExecutionEngineState.SYNCED],
        [ExecutionEngineState.SYNCED, ExecutionEngineState.SYNCED],
        [ExecutionEngineState.SYNCING, ExecutionEngineState.SYNCED],
      ],
      [ExecutionEngineState.SYNCING]: [
        [ExecutionEngineState.ONLINE, ExecutionEngineState.SYNCING],
        [ExecutionEngineState.AUTH_FAILED, ExecutionEngineState.SYNCING],
        [ExecutionEngineState.OFFLINE, ExecutionEngineState.SYNCING],
        [ExecutionEngineState.SYNCED, ExecutionEngineState.SYNCING],
        [ExecutionEngineState.SYNCING, ExecutionEngineState.SYNCING],
      ],
    };

    for (const payloadStatus of Object.keys(testCasesPayload) as ExecutionPayloadStatus[]) {
      for (const [oldState, newState] of testCasesPayload[payloadStatus]) {
        it(`should transition from "${oldState}" to "${newState}" on payload status "${payloadStatus}"`, () => {
          expect(getExecutionEngineState({payloadStatus, oldState})).toBe(newState);
        });
      }
    }

    for (const testCase of testCasesError) {
      const [message, payloadError, errorCases] = testCase;
      for (const [oldState, newState] of errorCases) {
        it(`should transition from "${oldState}" to "${newState}" on error "${message}"`, () => {
          expect(getExecutionEngineState({payloadError, oldState})).toBe(newState);
        });
      }
    }

    for (const targetState of Object.keys(testCasesTargetState) as ExecutionEngineState[]) {
      for (const [oldState, newState] of testCasesTargetState[targetState]) {
        it(`should transition from "${oldState}" to "${newState}" on when targeting "${targetState}"`, () => {
          expect(getExecutionEngineState({targetState, oldState})).toBe(newState);
        });
      }
    }
  });
});
