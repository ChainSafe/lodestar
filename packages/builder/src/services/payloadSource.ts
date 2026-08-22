import {IExecutionEngine, PayloadAttributes, PayloadId} from "@lodestar/beacon-node/execution";
import {ForkName, ForkPostGloas} from "@lodestar/params";
import {BlobsBundle, ExecutionPayload, RootHex, gloas} from "@lodestar/types";

export type ForkchoiceState = {
  headBlockHash: RootHex;
  safeBlockHash: RootHex;
  finalizedBlockHash: RootHex;
};

export type BuildRequest = {
  fork: ForkName;
  forkchoiceState: ForkchoiceState;
  payloadAttributes: PayloadAttributes;
};

export type BuildHandle = {
  sourceId: string;
  payloadId: PayloadId;
};

export type BuiltPayload = {
  sourceId: string;
  executionPayload: ExecutionPayload<ForkPostGloas>;
  executionRequests: gloas.ExecutionRequests;
  blobsBundle: BlobsBundle<ForkPostGloas>;
  /** Value of the payload to the fee recipient in wei, as reported by the execution client */
  executionPayloadValue: bigint;
};

/**
 * Something that builds execution payloads on request. The builder prepares a build on every
 * source and bids on the most valuable payload at the deadline.
 */
export interface PayloadSource {
  readonly id: string;
  /** Start building, throws if the source cannot build on the requested parent yet */
  prepare(req: BuildRequest): Promise<BuildHandle>;
  /** Fetch the best payload the source has built so far */
  getPayload(fork: ForkName, handle: BuildHandle): Promise<BuiltPayload>;
}

/**
 * Payload source backed by an execution client's Engine API. The execution client must be kept
 * in sync by a beacon node, the builder only issues forkchoiceUpdated with payload attributes
 * and getPayload.
 */
export class EnginePayloadSource implements PayloadSource {
  constructor(
    readonly id: string,
    private readonly engine: IExecutionEngine
  ) {}

  async prepare(req: BuildRequest): Promise<BuildHandle> {
    const {headBlockHash, safeBlockHash, finalizedBlockHash} = req.forkchoiceState;
    const payloadId = await this.engine.notifyForkchoiceUpdate(
      req.fork,
      headBlockHash,
      safeBlockHash,
      finalizedBlockHash,
      req.payloadAttributes
    );
    if (payloadId === null) {
      throw Error("Execution client did not return a payloadId");
    }
    return {sourceId: this.id, payloadId};
  }

  async getPayload(fork: ForkName, handle: BuildHandle): Promise<BuiltPayload> {
    const {executionPayload, executionPayloadValue, blobsBundle, executionRequests} = await this.engine.getPayload(
      fork,
      handle.payloadId
    );
    if (blobsBundle === undefined) {
      throw Error("Execution client did not return a blobs bundle");
    }
    if (executionRequests === undefined) {
      throw Error("Execution client did not return execution requests");
    }
    return {
      sourceId: this.id,
      executionPayload: executionPayload as ExecutionPayload<ForkPostGloas>,
      executionRequests: executionRequests as gloas.ExecutionRequests,
      blobsBundle: blobsBundle as BlobsBundle<ForkPostGloas>,
      executionPayloadValue,
    };
  }
}
