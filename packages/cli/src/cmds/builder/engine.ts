import {BitArray} from "@chainsafe/ssz";
import {
  EngineApiRpcParamTypes,
  EngineApiRpcReturnTypes,
  ExecutionPayloadStatus,
  JsonRpcHttpClient,
  parseExecutionPayload,
  serializePayloadAttributes,
} from "@lodestar/beacon-node/execution/engine";
import {PayloadSourceEngine} from "@lodestar/builder";
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
  signal?: AbortSignal;
  timeout?: number;
};

/** Uses one EL because payload IDs are local to the engine that prepared them. */
export function createPayloadSourceEngine({url, ...options}: BuilderEngineOptions): PayloadSourceEngine {
  const client = new JsonRpcHttpClient([url], options);
  return {
    async notifyForkchoiceUpdate(fork, headBlockHash, safeBlockHash, finalizedBlockHash, attributes, columns, signal) {
      if (fork !== ForkName.gloas) {
        throw new BuilderEngineError({code: BuilderEngineErrorCode.UNSUPPORTED_FORK, fork});
      }
      if ("inclusionListTransactions" in attributes) {
        throw new BuilderEngineError({code: BuilderEngineErrorCode.INVALID_ATTRIBUTES, fork});
      }

      let custodyColumns: string | null = null;
      if (columns !== null) {
        const bits = BitArray.fromBitLen(NUMBER_OF_COLUMNS);
        for (const column of columns) {
          if (!Number.isInteger(column) || column < 0 || column >= NUMBER_OF_COLUMNS) {
            throw new BuilderEngineError({code: BuilderEngineErrorCode.INVALID_CUSTODY_COLUMN, column});
          }
          bits.set(column, true);
        }
        custodyColumns = toHex(bits.uint8Array);
      }

      const method = "engine_forkchoiceUpdatedV4";
      const params: EngineApiRpcParamTypes[typeof method] = [
        {headBlockHash, safeBlockHash, finalizedBlockHash},
        serializePayloadAttributes(attributes),
        custodyColumns,
      ];
      const {payloadStatus, payloadId} = await client.fetch<
        EngineApiRpcReturnTypes[typeof method],
        EngineApiRpcParamTypes[typeof method]
      >({method, params}, {signal, routeId: method});

      if (payloadStatus.status === ExecutionPayloadStatus.SYNCING) {
        return null;
      }
      if (payloadStatus.status !== ExecutionPayloadStatus.VALID) {
        throw new BuilderEngineError({
          code: BuilderEngineErrorCode.PAYLOAD_NOT_VALID,
          status: payloadStatus.status,
          validationError: payloadStatus.validationError,
        });
      }
      return payloadId;
    },

    async getPayload(fork, payloadId, signal) {
      if (fork !== ForkName.gloas) {
        throw new BuilderEngineError({code: BuilderEngineErrorCode.UNSUPPORTED_FORK, fork});
      }
      const method = "engine_getPayloadV6";
      const response = await client.fetch<EngineApiRpcReturnTypes[typeof method]>(
        {method, params: [payloadId]},
        {signal, routeId: method}
      );
      return parseExecutionPayload(fork, response);
    },
  };
}
