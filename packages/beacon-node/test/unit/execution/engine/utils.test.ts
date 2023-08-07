import {expect} from "chai";
import {ErrorAborted} from "@lodestar/utils";
import {FetchError} from "@lodestar/api";
import {ExecutionPayloadStatus, ExecutionState} from "../../../../src/execution/index.js";
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
      [oldState: ExecutionState, newState: ExecutionState][]
    > = {
      [ExecutionPayloadStatus.ACCEPTED]: [
        [ExecutionState.ONLINE, ExecutionState.SYNCED],
        [ExecutionState.AUTH_FAILED, ExecutionState.SYNCED],
        [ExecutionState.OFFLINE, ExecutionState.SYNCED],
        [ExecutionState.SYNCED, ExecutionState.SYNCED],
        [ExecutionState.SYNCING, ExecutionState.SYNCED],
      ],
      [ExecutionPayloadStatus.VALID]: [
        [ExecutionState.ONLINE, ExecutionState.SYNCED],
        [ExecutionState.AUTH_FAILED, ExecutionState.SYNCED],
        [ExecutionState.OFFLINE, ExecutionState.SYNCED],
        [ExecutionState.SYNCED, ExecutionState.SYNCED],
        [ExecutionState.SYNCING, ExecutionState.SYNCED],
      ],
      [ExecutionPayloadStatus.UNSAFE_OPTIMISTIC_STATUS]: [
        [ExecutionState.ONLINE, ExecutionState.SYNCED],
        [ExecutionState.AUTH_FAILED, ExecutionState.SYNCED],
        [ExecutionState.OFFLINE, ExecutionState.SYNCED],
        [ExecutionState.SYNCED, ExecutionState.SYNCED],
        [ExecutionState.SYNCING, ExecutionState.SYNCED],
      ],
      [ExecutionPayloadStatus.ELERROR]: [
        [ExecutionState.ONLINE, ExecutionState.SYNCING],
        [ExecutionState.AUTH_FAILED, ExecutionState.SYNCING],
        [ExecutionState.OFFLINE, ExecutionState.SYNCING],
        [ExecutionState.SYNCED, ExecutionState.SYNCING],
        [ExecutionState.SYNCING, ExecutionState.SYNCING],
      ],
      [ExecutionPayloadStatus.INVALID]: [
        [ExecutionState.ONLINE, ExecutionState.SYNCING],
        [ExecutionState.AUTH_FAILED, ExecutionState.SYNCING],
        [ExecutionState.OFFLINE, ExecutionState.SYNCING],
        [ExecutionState.SYNCED, ExecutionState.SYNCING],
        [ExecutionState.SYNCING, ExecutionState.SYNCING],
      ],
      [ExecutionPayloadStatus.SYNCING]: [
        [ExecutionState.ONLINE, ExecutionState.SYNCING],
        [ExecutionState.AUTH_FAILED, ExecutionState.SYNCING],
        [ExecutionState.OFFLINE, ExecutionState.SYNCING],
        [ExecutionState.SYNCED, ExecutionState.SYNCING],
        [ExecutionState.SYNCING, ExecutionState.SYNCING],
      ],
      [ExecutionPayloadStatus.INVALID_BLOCK_HASH]: [
        [ExecutionState.ONLINE, ExecutionState.SYNCING],
        [ExecutionState.AUTH_FAILED, ExecutionState.SYNCING],
        [ExecutionState.OFFLINE, ExecutionState.SYNCING],
        [ExecutionState.SYNCED, ExecutionState.SYNCING],
        [ExecutionState.SYNCING, ExecutionState.SYNCING],
      ],
      [ExecutionPayloadStatus.UNAVAILABLE]: [
        [ExecutionState.ONLINE, ExecutionState.OFFLINE],
        [ExecutionState.AUTH_FAILED, ExecutionState.OFFLINE],
        [ExecutionState.OFFLINE, ExecutionState.OFFLINE],
        [ExecutionState.SYNCED, ExecutionState.OFFLINE],
        [ExecutionState.SYNCING, ExecutionState.OFFLINE],
      ],
      ["unknown" as ExecutionPayloadStatus]: [
        [ExecutionState.ONLINE, ExecutionState.ONLINE],
        [ExecutionState.AUTH_FAILED, ExecutionState.ONLINE],
        [ExecutionState.OFFLINE, ExecutionState.ONLINE],
        [ExecutionState.SYNCED, ExecutionState.SYNCED],
        [ExecutionState.SYNCING, ExecutionState.SYNCING],
      ],
    };

    type ErrorTestCase = [string, Error, [oldState: ExecutionState, newState: ExecutionState][]];
    const testCasesError: ErrorTestCase[] = [
      [
        "abort error",
        new ErrorAborted(),
        [
          [ExecutionState.ONLINE, ExecutionState.ONLINE],
          [ExecutionState.AUTH_FAILED, ExecutionState.AUTH_FAILED],
          [ExecutionState.OFFLINE, ExecutionState.OFFLINE],
          [ExecutionState.SYNCED, ExecutionState.SYNCED],
          [ExecutionState.SYNCING, ExecutionState.SYNCING],
        ],
      ],
      [
        "queue aborted error",
        new QueueError({code: QueueErrorCode.QUEUE_ABORTED}),
        [
          [ExecutionState.ONLINE, ExecutionState.ONLINE],
          [ExecutionState.AUTH_FAILED, ExecutionState.AUTH_FAILED],
          [ExecutionState.OFFLINE, ExecutionState.OFFLINE],
          [ExecutionState.SYNCED, ExecutionState.SYNCED],
          [ExecutionState.SYNCING, ExecutionState.SYNCING],
        ],
      ],
      [
        "rpc error",
        new HttpRpcError(12, "error"),
        [
          [ExecutionState.ONLINE, ExecutionState.SYNCING],
          [ExecutionState.AUTH_FAILED, ExecutionState.SYNCING],
          [ExecutionState.OFFLINE, ExecutionState.SYNCING],
          [ExecutionState.SYNCED, ExecutionState.SYNCING],
          [ExecutionState.SYNCING, ExecutionState.SYNCING],
        ],
      ],
      [
        "rpc response error",
        new ErrorJsonRpcResponse({jsonrpc: "2.0", id: 123, error: {code: 123, message: "error"}}, "error"),
        [
          [ExecutionState.ONLINE, ExecutionState.SYNCING],
          [ExecutionState.AUTH_FAILED, ExecutionState.SYNCING],
          [ExecutionState.OFFLINE, ExecutionState.SYNCING],
          [ExecutionState.SYNCED, ExecutionState.SYNCING],
          [ExecutionState.SYNCING, ExecutionState.SYNCING],
        ],
      ],
      ...HTTP_FATAL_ERROR_CODES.map((code) => {
        const error = new FetchError("http://localhost:1234", new TypeError("error"));
        error.code = code;

        return [
          `http error with code '${code}'`,
          error,
          [
            [ExecutionState.ONLINE, ExecutionState.OFFLINE],
            [ExecutionState.AUTH_FAILED, ExecutionState.OFFLINE],
            [ExecutionState.OFFLINE, ExecutionState.OFFLINE],
            [ExecutionState.SYNCED, ExecutionState.OFFLINE],
            [ExecutionState.SYNCING, ExecutionState.OFFLINE],
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
            [ExecutionState.ONLINE, ExecutionState.AUTH_FAILED],
            [ExecutionState.AUTH_FAILED, ExecutionState.AUTH_FAILED],
            [ExecutionState.OFFLINE, ExecutionState.AUTH_FAILED],
            [ExecutionState.SYNCED, ExecutionState.AUTH_FAILED],
            [ExecutionState.SYNCING, ExecutionState.AUTH_FAILED],
          ],
        ] as ErrorTestCase;
      }),
      [
        "unknown error",
        new Error("unknown error"),
        [
          [ExecutionState.ONLINE, ExecutionState.ONLINE],
          [ExecutionState.AUTH_FAILED, ExecutionState.AUTH_FAILED],
          [ExecutionState.OFFLINE, ExecutionState.OFFLINE],
          [ExecutionState.SYNCED, ExecutionState.SYNCED],
          [ExecutionState.SYNCING, ExecutionState.SYNCING],
        ],
      ],
    ];

    for (const payloadStatus of Object.keys(testCasesPayload) as ExecutionPayloadStatus[]) {
      for (const [oldState, newState] of testCasesPayload[payloadStatus]) {
        it(`should transition from "${oldState}" to "${newState}" on payload status "${payloadStatus}"`, () => {
          expect(getExecutionEngineState({payloadStatus, oldState})).to.equal(newState);
        });
      }
    }

    for (const testCase of testCasesError) {
      const [message, payloadError, errorCases] = testCase;
      for (const [oldState, newState] of errorCases) {
        it(`should transition from "${oldState}" to "${newState}" on error "${message}"`, () => {
          expect(getExecutionEngineState({payloadError, oldState})).to.equal(newState);
        });
      }
    }
  });
});
