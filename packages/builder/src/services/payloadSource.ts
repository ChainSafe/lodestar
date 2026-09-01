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

export type PayloadAttributes<F extends ForkPostGloas = ForkPostGloas> = SSEPayloadAttributes<F>["payloadAttributes"];

export type BuildRequest<F extends ForkPostGloas = ForkPostGloas> = {
  fork: F;
  forkchoiceState: ForkchoiceState;
  payloadAttributes: PayloadAttributes<F>;
  custodyColumns: ColumnIndex[];
};

export type BuildHandle<F extends ForkPostGloas = ForkPostGloas> = {
  sourceId: string;
  fork: F;
  payloadId: PayloadId;
};

export type BuiltPayload<F extends ForkPostGloas = ForkPostGloas> = {
  sourceId: string;
  fork: F;
  executionPayload: ExecutionPayload<F>;
  executionRequests: ExecutionRequests<F>;
  blobsBundle: BlobsBundle<F>;
  executionPayloadValue: bigint;
};

export type EnginePayloadResult = {
  executionPayload: ExecutionPayload<ForkPostGloas>;
  executionPayloadValue: bigint;
  blobsBundle?: BlobsBundle<ForkPostGloas>;
  executionRequests?: ExecutionRequests<ForkPostGloas>;
};

/** Narrow Engine API boundary whose transport owns request retries, timeouts, and Builder-lifetime cancellation. */
export interface PayloadSourceEngine {
  notifyForkchoiceUpdate(
    fork: ForkPostGloas,
    headBlockHash: RootHex,
    safeBlockHash: RootHex,
    finalizedBlockHash: RootHex,
    payloadAttributes: PayloadAttributes,
    custodyColumns: ColumnIndex[]
  ): Promise<PayloadId | null>;
  getPayload(fork: ForkPostGloas, payloadId: PayloadId): Promise<EnginePayloadResult>;
}

/** Source that prepares and retrieves complete execution payloads without owning build scheduling policy. */
export interface PayloadSource {
  readonly id: string;
  prepare<F extends ForkPostGloas>(request: BuildRequest<F>): Promise<BuildHandle<F>>;
  getPayload<F extends ForkPostGloas>(handle: BuildHandle<F>): Promise<BuiltPayload<F>>;
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

  async prepare<F extends ForkPostGloas>(request: BuildRequest<F>): Promise<BuildHandle<F>> {
    const {headBlockHash, safeBlockHash, finalizedBlockHash} = request.forkchoiceState;
    const payloadId = await this.engine.notifyForkchoiceUpdate(
      request.fork,
      headBlockHash,
      safeBlockHash,
      finalizedBlockHash,
      request.payloadAttributes,
      request.custodyColumns
    );

    if (payloadId === null) {
      throw new PayloadSourceError(
        {code: PayloadSourceErrorCode.NO_PAYLOAD_ID, sourceId: this.id},
        `Execution client did not return a payload ID sourceId=${this.id}`
      );
    }

    return {sourceId: this.id, fork: request.fork, payloadId};
  }

  async getPayload<F extends ForkPostGloas>(handle: BuildHandle<F>): Promise<BuiltPayload<F>> {
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
      executionPayload: executionPayload as ExecutionPayload<F>,
      executionRequests: executionRequests as ExecutionRequests<F>,
      blobsBundle: blobsBundle as BlobsBundle<F>,
      executionPayloadValue,
    };
  }
}
