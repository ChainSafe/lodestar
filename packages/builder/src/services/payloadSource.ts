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
import type {OfferEligibility} from "./offerEligibility.js";
import type {OrderMetadata} from "./orderMetadata.js";

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
  /** One-shot alternate work must use a constructor that rejects renewable leases before allocation. */
  requireUnleased?: boolean;
  /** Alternate with an exact, renewable permission that survives confirmed worker release. */
  requireRetainedOffer?: boolean;
};

export function isAlternateBuild(request: BuildRequest): boolean {
  return request.requireUnleased === true || request.requireRetainedOffer === true;
}

/** Disjoint physical reservations. A timeout never proves a constructor slot is free. */
export type PayloadSourceResources = {
  capacity: 2;
  preparing: number;
  active: number;
  releasing: number;
  uncertain: number;
  alternatesDisabled: boolean;
};

export type BuildHandle = {
  sourceId: string;
  fork: ForkPostGloas;
  payloadId: PayloadId;
};

export type BuiltPayload = {
  orderMetadata?: OrderMetadata;
  sourceId: string;
  fork: ForkPostGloas;
  executionPayload: ExecutionPayload<ForkPostGloas>;
  executionRequests: ExecutionRequests<ForkPostGloas>;
  blobsBundle: BlobsBundle<ForkPostGloas>;
  executionPayloadValue: bigint;
  /** Optional volatile authorization for new offers. Retention is independent. */
  offerEligibility?: OfferEligibility;
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
  /** getPayload may return successive immutable snapshots from the same handle. */
  readonly supportsUpdates?: boolean;
  readonly supportsBoundedAlternates?: boolean;
  readonly supportsRetainedOffers?: boolean;
  readonly supportsPrimaryHandoff?: boolean;
  getResources?(): PayloadSourceResources | undefined;
  /** Retry only recorded end operations; an anonymous timed-out begin cannot be reclaimed by inference. */
  reconcileResources?(signal: AbortSignal): Promise<void>;
  prepare(request: BuildRequest, signal: AbortSignal): Promise<BuildHandle>;
  getPayload(handle: BuildHandle, signal: AbortSignal): Promise<BuiltPayload>;
  /** Acquire independent permission for the exact current primary snapshot, without rebuilding it. */
  retainPrimaryPayload?(handle: BuildHandle, payload: BuiltPayload, signal: AbortSignal): Promise<BuiltPayload>;
  /** Renew only the exact immutable payload's permission. Never re-stamp an older generation. */
  renewOffer?(payload: BuiltPayload, signal: AbortSignal): Promise<boolean>;
  releaseOffer?(payload: BuiltPayload, signal: AbortSignal): Promise<void>;
  /** Release construction resources without invalidating previously returned payloads. */
  release?(handle: BuildHandle, signal: AbortSignal): Promise<void>;
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
