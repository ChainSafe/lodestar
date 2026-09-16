import type {ForkPostGloas} from "@lodestar/params";
import type {
  BlobsBundle,
  ColumnIndex,
  ExecutionPayload,
  ExecutionRequests,
  RootHex,
  SSEPayloadAttributes,
} from "@lodestar/types";
import {LodestarError} from "@lodestar/utils";

export type PayloadId = string;

export type ForkchoiceState = {
  headBlockHash: RootHex;
  safeBlockHash: RootHex;
  finalizedBlockHash: RootHex;
};

export type PayloadAttributes = SSEPayloadAttributes<ForkPostGloas>["payloadAttributes"];

export type BuildRequest = {
  fork: ForkPostGloas;
  forkchoiceState: ForkchoiceState;
  payloadAttributes: PayloadAttributes;
};

export type BuildHandle = {
  sourceId: string;
  fork: ForkPostGloas;
  payloadId: PayloadId;
};

export type BuiltPayload = {
  sourceId: string;
  fork: ForkPostGloas;
  executionPayload: ExecutionPayload<ForkPostGloas>;
  executionRequests: ExecutionRequests<ForkPostGloas>;
  blobsBundle: BlobsBundle<ForkPostGloas>;
  executionPayloadValue: bigint;
};

export type EnginePayloadResult = {
  executionPayload: ExecutionPayload<ForkPostGloas>;
  executionPayloadValue: bigint;
  blobsBundle?: BlobsBundle<ForkPostGloas>;
  executionRequests?: ExecutionRequests<ForkPostGloas>;
};

/** Narrow Engine boundary whose transport owns serialization, retries, and request execution. */
export interface PayloadSourceEngine {
  notifyForkchoiceUpdate(
    fork: ForkPostGloas,
    headBlockHash: RootHex,
    safeBlockHash: RootHex,
    finalizedBlockHash: RootHex,
    payloadAttributes: PayloadAttributes,
    custodyColumns: ColumnIndex[] | null,
    signal: AbortSignal
  ): Promise<PayloadId | null>;
  getPayload(fork: ForkPostGloas, payloadId: PayloadId, signal: AbortSignal): Promise<EnginePayloadResult>;
}

/** Source that prepares and retrieves complete execution payloads without owning build scheduling policy. */
export interface PayloadSource {
  readonly id: string;
  prepare(request: BuildRequest, signal: AbortSignal): Promise<BuildHandle>;
  getPayload(handle: BuildHandle, signal: AbortSignal): Promise<BuiltPayload>;
}

export enum PayloadSourceErrorCode {
  NO_PAYLOAD_ID = "PAYLOAD_SOURCE_ERROR_NO_PAYLOAD_ID",
  MISSING_BLOBS_BUNDLE = "PAYLOAD_SOURCE_ERROR_MISSING_BLOBS_BUNDLE",
  MISSING_EXECUTION_REQUESTS = "PAYLOAD_SOURCE_ERROR_MISSING_EXECUTION_REQUESTS",
}

export type PayloadSourceErrorType =
  | {code: PayloadSourceErrorCode.NO_PAYLOAD_ID; sourceId: string}
  | {
      code: PayloadSourceErrorCode.MISSING_BLOBS_BUNDLE | PayloadSourceErrorCode.MISSING_EXECUTION_REQUESTS;
      sourceId: string;
      payloadId: PayloadId;
    };

export class PayloadSourceError extends LodestarError<PayloadSourceErrorType> {}

/** Payload source backed by an injected Engine boundary. Engine ownership and lifecycle remain caller policy. */
export class EnginePayloadSource implements PayloadSource {
  constructor(
    readonly id: string,
    private readonly engine: PayloadSourceEngine
  ) {}

  async prepare(request: BuildRequest, signal: AbortSignal): Promise<BuildHandle> {
    const {headBlockHash, safeBlockHash, finalizedBlockHash} = request.forkchoiceState;
    const payloadId = await this.engine.notifyForkchoiceUpdate(
      request.fork,
      headBlockHash,
      safeBlockHash,
      finalizedBlockHash,
      request.payloadAttributes,
      // The builder does not custody or sample data columns, so it never provides a custody set.
      // A null custody set leaves the execution client's blobpool sampling set untouched, which is
      // also what the spec's own build call does (`prepare_execution_payload` passes `custody_columns=None`).
      null,
      signal
    );

    if (payloadId === null) {
      throw new PayloadSourceError(
        {code: PayloadSourceErrorCode.NO_PAYLOAD_ID, sourceId: this.id},
        `Execution client did not return a payload ID sourceId=${this.id}`
      );
    }

    return {sourceId: this.id, fork: request.fork, payloadId};
  }

  async getPayload(handle: BuildHandle, signal: AbortSignal): Promise<BuiltPayload> {
    const {executionPayload, executionPayloadValue, blobsBundle, executionRequests} = await this.engine.getPayload(
      handle.fork,
      handle.payloadId,
      signal
    );

    if (blobsBundle === undefined) {
      throw new PayloadSourceError(
        {
          code: PayloadSourceErrorCode.MISSING_BLOBS_BUNDLE,
          sourceId: this.id,
          payloadId: handle.payloadId,
        },
        `Execution client did not return a blobs bundle sourceId=${this.id} payloadId=${handle.payloadId}`
      );
    }

    if (executionRequests === undefined) {
      throw new PayloadSourceError(
        {
          code: PayloadSourceErrorCode.MISSING_EXECUTION_REQUESTS,
          sourceId: this.id,
          payloadId: handle.payloadId,
        },
        `Execution client did not return execution requests sourceId=${this.id} payloadId=${handle.payloadId}`
      );
    }

    return {
      sourceId: this.id,
      fork: handle.fork,
      executionPayload,
      executionRequests,
      blobsBundle,
      executionPayloadValue,
    };
  }
}
