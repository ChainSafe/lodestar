import {ExecutionStatus, IForkChoice, LVHInvalidResponse} from "@lodestar/fork-choice";
import {ForkName, ForkPostFulu, ForkPreFulu, isForkPostFulu} from "@lodestar/params";
import {RootHex, bellatrix} from "@lodestar/types";
import {BlobAndProof} from "@lodestar/types/deneb";
import {BlobAndProofV2} from "@lodestar/types/fulu";
import {Logger} from "@lodestar/utils";
import {ExecutionPayloadBodyV2} from "../execution/engine/types.js";
import {DATA} from "../execution/engine/utils.js";
import {
  ClientVersion,
  ExecutionEngineState,
  ExecutionPayloadStatus,
  ForkchoiceUpdatedResult,
  IExecutionEngine,
  PayloadAttributes,
  PayloadId,
  PayloadIdCache,
  VersionedHashes,
} from "../execution/index.js";
import {Metrics} from "../metrics/index.js";
import {ExecutionInvalidSource} from "./forkChoice/index.js";

export type OptimisticExecutionEngineModules = {
  forkChoice: IForkChoice;
  /** Recompute and switch the chain head, fork choice is already updated when this runs */
  recomputeHeadAfterELInvalidResponse: () => void;
  logger: Logger;
  metrics: Metrics | null;
};

/**
 * The only handle on the execution engine. Payloads are imported optimistically, so every engine verdict that can
 * change fork choice is applied here: forkchoiceUpdated verdicts in `notifyForkchoiceUpdate`, and INVALID verdicts
 * from elsewhere through `invalidateExecutionPayloads`. The raw engine is not reachable from outside, so no caller
 * can drop a verdict.
 */
export class OptimisticExecutionEngine {
  private readonly forkChoice: IForkChoice;
  private readonly recomputeHeadAfterELInvalidResponse: () => void;
  private readonly logger: Logger;
  private readonly metrics: Metrics | null;

  constructor(
    private readonly engine: IExecutionEngine,
    modules: OptimisticExecutionEngineModules
  ) {
    this.forkChoice = modules.forkChoice;
    this.recomputeHeadAfterELInvalidResponse = modules.recomputeHeadAfterELInvalidResponse;
    this.logger = modules.logger;
    this.metrics = modules.metrics;
  }

  get state(): ExecutionEngineState {
    return this.engine.state;
  }

  get clientVersion(): ClientVersion | null | undefined {
    return this.engine.clientVersion;
  }

  get payloadIdCache(): PayloadIdCache {
    return this.engine.payloadIdCache;
  }

  notifyNewPayload(
    ...args: Parameters<IExecutionEngine["notifyNewPayload"]>
  ): ReturnType<IExecutionEngine["notifyNewPayload"]> {
    return this.engine.notifyNewPayload(...args);
  }

  /**
   * `headBlockRoot` is the root of the node whose payload hash is sent as `headBlockHash`, captured by the caller
   * before the call: root and hash identify the exact fork choice node, gloas variant included.
   *
   * The verdict is applied to fork choice before returning. An INVALID verdict throws when preparing a payload so
   * block production fails, otherwise it resolves to null.
   */
  async notifyForkchoiceUpdate(
    fork: ForkName,
    headBlockRoot: RootHex,
    headBlockHash: RootHex,
    safeBlockHash: RootHex,
    finalizedBlockHash: RootHex,
    payloadAttributes?: PayloadAttributes
  ): Promise<PayloadId | null> {
    const result = await this.engine.notifyForkchoiceUpdate(
      fork,
      headBlockHash,
      safeBlockHash,
      finalizedBlockHash,
      payloadAttributes
    );
    this.applyForkchoiceUpdatedResult(headBlockRoot, headBlockHash, result);

    if (result.payloadStatus.status === ExecutionPayloadStatus.INVALID) {
      if (payloadAttributes) {
        throw Error(`Invalid prepare payload, validationError=${result.payloadStatus.validationError ?? ""}`);
      }
      return null;
    }
    return result.payloadId;
  }

  getPayload(...args: Parameters<IExecutionEngine["getPayload"]>): ReturnType<IExecutionEngine["getPayload"]> {
    return this.engine.getPayload(...args);
  }

  getInclusionList(): Promise<bellatrix.Transactions> {
    return this.engine.getInclusionList();
  }

  getPayloadBodiesByHashV2(blockHashes: DATA[]): Promise<(ExecutionPayloadBodyV2 | null)[]> {
    return this.engine.getPayloadBodiesByHashV2(blockHashes);
  }

  getBlobs(
    fork: ForkPostFulu,
    versionedHashes: VersionedHashes,
    buffers?: Uint8Array[]
  ): Promise<BlobAndProofV2[] | null>;
  getBlobs(
    fork: ForkPreFulu,
    versionedHashes: VersionedHashes,
    buffers?: Uint8Array[]
  ): Promise<(BlobAndProof | null)[]>;
  getBlobs(
    fork: ForkName,
    versionedHashes: VersionedHashes,
    buffers?: Uint8Array[]
  ): Promise<BlobAndProofV2[] | (BlobAndProof | null)[] | null> {
    if (isForkPostFulu(fork)) {
      return this.engine.getBlobs(fork, versionedHashes, buffers);
    }
    return this.engine.getBlobs(fork as ForkPreFulu, versionedHashes, buffers);
  }

  /**
   * Apply an execution engine INVALID verdict to fork choice and move the chain head off the invalid chain
   */
  invalidateExecutionPayloads(lvh: LVHInvalidResponse, source: ExecutionInvalidSource): void {
    const logCtx = {
      source,
      blockRoot: lvh.invalidateFromParentBlockRoot,
      blockHash: lvh.invalidateFromParentBlockHash,
      latestValidHash: lvh.latestValidExecHash ?? "null",
    };
    const applied = this.forkChoice.validateLatestHash(lvh, {strict: source === ExecutionInvalidSource.blockSegment});
    if (!applied) {
      this.logger.warn("Execution engine INVALID verdict not applied to fork choice", logCtx);
      return;
    }
    this.metrics?.forkChoice.executionInvalidations.inc({source});
    this.logger.warn("Invalidated execution payloads in fork choice", logCtx);

    try {
      this.recomputeHeadAfterELInvalidResponse();
    } catch (e) {
      this.logger.error("Error recomputing head after execution payload invalidation", logCtx, e as Error);
    }
  }

  private applyForkchoiceUpdatedResult(
    headBlockRoot: RootHex,
    headBlockHash: RootHex,
    result: ForkchoiceUpdatedResult
  ): void {
    const {status, latestValidHash, validationError} = result.payloadStatus;
    const executionStatus = this.forkChoice.getBlockHexAndBlockHash(headBlockRoot, headBlockHash)?.executionStatus;
    try {
      if (status === ExecutionPayloadStatus.INVALID) {
        if (executionStatus === ExecutionStatus.Invalid) {
          return;
        }
        this.logger.error("Execution engine reported INVALID forkchoice head", {
          headBlockRoot,
          headBlockHash,
          latestValidHash: latestValidHash ?? "null",
          validationError: validationError ?? "",
        });
        this.invalidateExecutionPayloads(
          {
            executionStatus: ExecutionStatus.Invalid,
            latestValidExecHash: latestValidHash,
            invalidateFromParentBlockRoot: headBlockRoot,
            invalidateFromParentBlockHash: headBlockHash,
          },
          ExecutionInvalidSource.forkchoiceUpdated
        );
      } else if (status === ExecutionPayloadStatus.VALID && executionStatus === ExecutionStatus.Syncing) {
        this.forkChoice.validateLatestHash(
          {executionStatus: ExecutionStatus.Valid, latestValidExecHash: headBlockHash, blockRoot: headBlockRoot},
          {strict: false}
        );
      }
    } catch (e) {
      this.logger.error("Error applying forkchoice update result", {headBlockRoot, headBlockHash, status}, e as Error);
    }
  }
}
