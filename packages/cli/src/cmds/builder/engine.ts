import {BitArray} from "@chainsafe/ssz";
import {
  type EngineApiMode,
  ExecutionPayloadStatus,
  HttpRpcError,
  getExecutionEngineHttp,
  isRetryableEngineRestError,
} from "@lodestar/beacon-node/execution/engine";
import {type EnginePayloadResult, type PayloadSourceEngine} from "@lodestar/builder";
import {type Logger} from "@lodestar/logger";
import {ForkName, NUMBER_OF_COLUMNS} from "@lodestar/params";
import {LodestarError, toHex} from "@lodestar/utils";

export enum BuilderEngineErrorCode {
  UNSUPPORTED_FORK = "BUILDER_ENGINE_UNSUPPORTED_FORK",
  INVALID_ATTRIBUTES = "BUILDER_ENGINE_INVALID_ATTRIBUTES",
  INVALID_CUSTODY_COLUMN = "BUILDER_ENGINE_INVALID_CUSTODY_COLUMN",
  PAYLOAD_NOT_VALID = "BUILDER_ENGINE_PAYLOAD_NOT_VALID",
}

type BuilderEngineErrorType =
  | {code: BuilderEngineErrorCode.UNSUPPORTED_FORK; fork: string}
  | {code: BuilderEngineErrorCode.INVALID_ATTRIBUTES; fork: string}
  | {code: BuilderEngineErrorCode.INVALID_CUSTODY_COLUMN; column: number}
  | {code: BuilderEngineErrorCode.PAYLOAD_NOT_VALID; status: string; validationError: string | null};

export class BuilderEngineError extends LodestarError<BuilderEngineErrorType> {}

export type BuilderEngineOptions = {
  url: string;
  jwtSecret: Uint8Array;
  signal: AbortSignal;
  logger: Logger;
  timeout?: number;
  engineApi?: EngineApiMode;
};

/** Uses one EL because payload IDs are local to the engine that prepared them. */
export function createPayloadSourceEngine({
  url,
  jwtSecret,
  signal,
  logger,
  ...options
}: BuilderEngineOptions): PayloadSourceEngine {
  const engine = getExecutionEngineHttp(
    {urls: [url], jwtSecretHex: toHex(jwtSecret), retries: 2, retryDelay: 100, ...options},
    {signal, logger}
  );
  return {
    async notifyForkchoiceUpdate(
      fork,
      headBlockHash,
      safeBlockHash,
      finalizedBlockHash,
      attributes,
      columns,
      requestSignal
    ) {
      if (fork !== ForkName.gloas) {
        throw new BuilderEngineError({code: BuilderEngineErrorCode.UNSUPPORTED_FORK, fork});
      }
      if ("inclusionListTransactions" in attributes) {
        throw new BuilderEngineError({code: BuilderEngineErrorCode.INVALID_ATTRIBUTES, fork});
      }
      let custodyColumns: BitArray | null = null;
      if (columns !== null) {
        custodyColumns = BitArray.fromBitLen(NUMBER_OF_COLUMNS);
        for (const column of columns) {
          if (!Number.isInteger(column) || column < 0 || column >= NUMBER_OF_COLUMNS) {
            throw new BuilderEngineError({code: BuilderEngineErrorCode.INVALID_CUSTODY_COLUMN, column});
          }
          custodyColumns.set(column, true);
        }
      }
      const {payloadStatus, payloadId} = await engine.forkchoiceUpdated(
        fork,
        headBlockHash,
        safeBlockHash,
        finalizedBlockHash,
        attributes,
        custodyColumns,
        {signal: requestSignal, shouldRetry: shouldRetryEngineRequest}
      );
      if (payloadStatus.status === ExecutionPayloadStatus.SYNCING) return null;
      if (payloadStatus.status !== ExecutionPayloadStatus.VALID) {
        throw new BuilderEngineError({
          code: BuilderEngineErrorCode.PAYLOAD_NOT_VALID,
          status: payloadStatus.status,
          validationError: payloadStatus.validationError,
        });
      }
      return payloadId;
    },

    async getPayload(fork, payloadId, requestSignal) {
      if (fork !== ForkName.gloas) {
        throw new BuilderEngineError({code: BuilderEngineErrorCode.UNSUPPORTED_FORK, fork});
      }
      // Both transports decode this fork with the Gloas codec.
      return (await engine.getPayload(fork, payloadId, {
        signal: requestSignal,
        shouldRetry: shouldRetryEngineRequest,
      })) as EnginePayloadResult;
    },
  };
}

function shouldRetryEngineRequest(error: Error): boolean {
  if (error instanceof HttpRpcError) return error.status === 429 || (error.status >= 500 && error.status < 600);
  return isRetryableEngineRestError(error);
}
