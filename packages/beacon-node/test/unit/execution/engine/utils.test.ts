import {expect} from "chai";
import {ErrorAborted} from "@lodestar/utils";
import {ExecutePayloadStatus, ExecutionEngineState} from "../../../../src/execution/index.js";
import {
  HTTP_CONNECTION_ERROR_CODES,
  HTTP_FATAL_ERROR_CODES,
  getExecutionEngineState,
} from "../../../../src/execution/engine/utils.js";
import {QueueError, QueueErrorCode} from "../../../../src/util/queue/errors.js";
import {ErrorJsonRpcResponse, HttpRpcError} from "../../../../src/eth1/provider/jsonRpcHttpClient.js";

describe("execution/engine/utils", () => {
  describe("getExecutionEngineState", () => {
    const testCasesPayload: Record<
      ExecutePayloadStatus,
      [oldState: ExecutionEngineState, newState: ExecutionEngineState][]
    > = {
      [ExecutePayloadStatus.ACCEPTED]: [
        [ExecutionEngineState.ONLINE, ExecutionEngineState.SYNCED],
        [ExecutionEngineState.AUTH_FAILED, ExecutionEngineState.SYNCED],
        [ExecutionEngineState.OFFLINE, ExecutionEngineState.SYNCED],
        [ExecutionEngineState.SYNCED, ExecutionEngineState.SYNCED],
        [ExecutionEngineState.SYNCING, ExecutionEngineState.SYNCED],
      ],
      [ExecutePayloadStatus.VALID]: [
        [ExecutionEngineState.ONLINE, ExecutionEngineState.SYNCED],
        [ExecutionEngineState.AUTH_FAILED, ExecutionEngineState.SYNCED],
        [ExecutionEngineState.OFFLINE, ExecutionEngineState.SYNCED],
        [ExecutionEngineState.SYNCED, ExecutionEngineState.SYNCED],
        [ExecutionEngineState.SYNCING, ExecutionEngineState.SYNCED],
      ],
      [ExecutePayloadStatus.UNSAFE_OPTIMISTIC_STATUS]: [
        [ExecutionEngineState.ONLINE, ExecutionEngineState.SYNCED],
        [ExecutionEngineState.AUTH_FAILED, ExecutionEngineState.SYNCED],
        [ExecutionEngineState.OFFLINE, ExecutionEngineState.SYNCED],
        [ExecutionEngineState.SYNCED, ExecutionEngineState.SYNCED],
        [ExecutionEngineState.SYNCING, ExecutionEngineState.SYNCED],
      ],
      [ExecutePayloadStatus.ELERROR]: [
        [ExecutionEngineState.ONLINE, ExecutionEngineState.SYNCING],
        [ExecutionEngineState.AUTH_FAILED, ExecutionEngineState.SYNCING],
        [ExecutionEngineState.OFFLINE, ExecutionEngineState.SYNCING],
        [ExecutionEngineState.SYNCED, ExecutionEngineState.SYNCING],
        [ExecutionEngineState.SYNCING, ExecutionEngineState.SYNCING],
      ],
      [ExecutePayloadStatus.INVALID]: [
        [ExecutionEngineState.ONLINE, ExecutionEngineState.SYNCING],
        [ExecutionEngineState.AUTH_FAILED, ExecutionEngineState.SYNCING],
        [ExecutionEngineState.OFFLINE, ExecutionEngineState.SYNCING],
        [ExecutionEngineState.SYNCED, ExecutionEngineState.SYNCING],
        [ExecutionEngineState.SYNCING, ExecutionEngineState.SYNCING],
      ],
      [ExecutePayloadStatus.SYNCING]: [
        [ExecutionEngineState.ONLINE, ExecutionEngineState.SYNCING],
        [ExecutionEngineState.AUTH_FAILED, ExecutionEngineState.SYNCING],
        [ExecutionEngineState.OFFLINE, ExecutionEngineState.SYNCING],
        [ExecutionEngineState.SYNCED, ExecutionEngineState.SYNCING],
        [ExecutionEngineState.SYNCING, ExecutionEngineState.SYNCING],
      ],
      [ExecutePayloadStatus.INVALID_BLOCK_HASH]: [
        [ExecutionEngineState.ONLINE, ExecutionEngineState.SYNCING],
        [ExecutionEngineState.AUTH_FAILED, ExecutionEngineState.SYNCING],
        [ExecutionEngineState.OFFLINE, ExecutionEngineState.SYNCING],
        [ExecutionEngineState.SYNCED, ExecutionEngineState.SYNCING],
        [ExecutionEngineState.SYNCING, ExecutionEngineState.SYNCING],
      ],
      [ExecutePayloadStatus.UNAVAILABLE]: [
        [ExecutionEngineState.ONLINE, ExecutionEngineState.OFFLINE],
        [ExecutionEngineState.AUTH_FAILED, ExecutionEngineState.OFFLINE],
        [ExecutionEngineState.OFFLINE, ExecutionEngineState.OFFLINE],
        [ExecutionEngineState.SYNCED, ExecutionEngineState.OFFLINE],
        [ExecutionEngineState.SYNCING, ExecutionEngineState.OFFLINE],
      ],
      ["unknown" as ExecutePayloadStatus]: [
        [ExecutionEngineState.ONLINE, ExecutionEngineState.ONLINE],
        [ExecutionEngineState.AUTH_FAILED, ExecutionEngineState.ONLINE],
        [ExecutionEngineState.OFFLINE, ExecutionEngineState.ONLINE],
        [ExecutionEngineState.SYNCED, ExecutionEngineState.SYNCED],
        [ExecutionEngineState.SYNCING, ExecutionEngineState.SYNCING],
      ],
    };

    type ErrorTestCase = [
      string,
      Error,
      [oldState: ExecutionEngineState, newState: ExecutionEngineState | undefined][],
    ];
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
      ...HTTP_FATAL_ERROR_CODES.map(
        (code) =>
          [
            `http error with code '${code}'`,
            {code: code, errno: "error"} as unknown as Error,
            [
              [ExecutionEngineState.ONLINE, ExecutionEngineState.OFFLINE],
              [ExecutionEngineState.AUTH_FAILED, ExecutionEngineState.OFFLINE],
              [ExecutionEngineState.OFFLINE, ExecutionEngineState.OFFLINE],
              [ExecutionEngineState.SYNCED, ExecutionEngineState.OFFLINE],
              [ExecutionEngineState.SYNCING, ExecutionEngineState.OFFLINE],
            ],
          ] as ErrorTestCase
      ),
      ...HTTP_CONNECTION_ERROR_CODES.map(
        (code) =>
          [
            `http error with code '${code}'`,
            {code: code, errno: "error"} as unknown as Error,
            [
              [ExecutionEngineState.ONLINE, ExecutionEngineState.AUTH_FAILED],
              [ExecutionEngineState.AUTH_FAILED, ExecutionEngineState.AUTH_FAILED],
              [ExecutionEngineState.OFFLINE, ExecutionEngineState.AUTH_FAILED],
              [ExecutionEngineState.SYNCED, ExecutionEngineState.AUTH_FAILED],
              [ExecutionEngineState.SYNCING, ExecutionEngineState.AUTH_FAILED],
            ],
          ] as ErrorTestCase
      ),
      [
        "unknown error",
        new Error("unknown error"),
        [
          [ExecutionEngineState.ONLINE, undefined],
          [ExecutionEngineState.AUTH_FAILED, undefined],
          [ExecutionEngineState.OFFLINE, undefined],
          [ExecutionEngineState.SYNCED, undefined],
          [ExecutionEngineState.SYNCING, undefined],
        ],
      ],
    ];

    for (const payloadStatus of Object.keys(testCasesPayload) as ExecutePayloadStatus[]) {
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
