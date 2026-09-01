import type {ForkPostGloas} from "@lodestar/params";
import type {BlobsBundle, ExecutionPayload, ExecutionRequests, RootHex, gloas} from "@lodestar/types";
import {LodestarError} from "@lodestar/utils";

export type PayloadId = string;

export type ForkchoiceState = {
  headBlockHash: RootHex;
  safeBlockHash: RootHex;
  finalizedBlockHash: RootHex;
};

export type BuildRequest = {
  fork: ForkPostGloas;
  forkchoiceState: ForkchoiceState;
  payloadAttributes: gloas.PayloadAttributes;
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
  executionPayload: ExecutionPayload;
  executionPayloadValue: bigint;
  blobsBundle?: BlobsBundle;
  executionRequests?: ExecutionRequests;
};

/** Narrow Engine API boundary required by an Engine-backed payload source. */
export interface PayloadSourceEngine {
  notifyForkchoiceUpdate(
    fork: ForkPostGloas,
    headBlockHash: RootHex,
    safeBlockHash: RootHex,
    finalizedBlockHash: RootHex,
    payloadAttributes: gloas.PayloadAttributes
  ): Promise<PayloadId | null>;
  getPayload(fork: ForkPostGloas, payloadId: PayloadId): Promise<EnginePayloadResult>;
}

/** Source that prepares and retrieves complete execution payloads. */
export interface PayloadSource {
  readonly id: string;
  prepare(request: BuildRequest): Promise<BuildHandle>;
  getPayload(handle: BuildHandle): Promise<BuiltPayload>;
}

export enum PayloadSourceErrorCode {
  NO_PAYLOAD_ID = "PAYLOAD_SOURCE_ERROR_NO_PAYLOAD_ID",
  SOURCE_MISMATCH = "PAYLOAD_SOURCE_ERROR_SOURCE_MISMATCH",
  MISSING_BLOBS_BUNDLE = "PAYLOAD_SOURCE_ERROR_MISSING_BLOBS_BUNDLE",
  MISSING_EXECUTION_REQUESTS = "PAYLOAD_SOURCE_ERROR_MISSING_EXECUTION_REQUESTS",
}

export type PayloadSourceErrorType =
  | {code: PayloadSourceErrorCode.NO_PAYLOAD_ID; sourceId: string}
  | {
      code: PayloadSourceErrorCode.SOURCE_MISMATCH;
      sourceId: string;
      handleSourceId: string;
    }
  | {
      code: PayloadSourceErrorCode.MISSING_BLOBS_BUNDLE | PayloadSourceErrorCode.MISSING_EXECUTION_REQUESTS;
      sourceId: string;
      payloadId: PayloadId;
    };

export class PayloadSourceError extends LodestarError<PayloadSourceErrorType> {}

/** Payload source backed by an execution client's Engine API. */
export class EnginePayloadSource implements PayloadSource {
  constructor(
    readonly id: string,
    private readonly engine: PayloadSourceEngine
  ) {}

  async prepare(request: BuildRequest): Promise<BuildHandle> {
    const {headBlockHash, safeBlockHash, finalizedBlockHash} = request.forkchoiceState;
    const payloadId = await this.engine.notifyForkchoiceUpdate(
      request.fork,
      headBlockHash,
      safeBlockHash,
      finalizedBlockHash,
      request.payloadAttributes
    );

    if (payloadId === null) {
      throw new PayloadSourceError(
        {code: PayloadSourceErrorCode.NO_PAYLOAD_ID, sourceId: this.id},
        `Execution client did not return a payload ID sourceId=${this.id}`
      );
    }

    return {sourceId: this.id, fork: request.fork, payloadId};
  }

  async getPayload(handle: BuildHandle): Promise<BuiltPayload> {
    if (handle.sourceId !== this.id) {
      throw new PayloadSourceError(
        {
          code: PayloadSourceErrorCode.SOURCE_MISMATCH,
          sourceId: this.id,
          handleSourceId: handle.sourceId,
        },
        `Payload handle belongs to another source sourceId=${this.id} handleSourceId=${handle.sourceId}`
      );
    }

    const {executionPayload, executionPayloadValue, blobsBundle, executionRequests} = await this.engine.getPayload(
      handle.fork,
      handle.payloadId
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
      executionPayload: executionPayload as ExecutionPayload<ForkPostGloas>,
      executionRequests: executionRequests as ExecutionRequests<ForkPostGloas>,
      blobsBundle: blobsBundle as BlobsBundle<ForkPostGloas>,
      executionPayloadValue,
    };
  }
}
