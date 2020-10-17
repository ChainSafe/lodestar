import {readOnlyMap, toHexString} from "@chainsafe/ssz";
import {Attestation, Checkpoint, SignedBeaconBlock, Slot} from "@chainsafe/lodestar-types";
import {ILogger, toJson} from "@chainsafe/lodestar-utils";
import {IBlockSummary} from "@chainsafe/lodestar-fork-choice";

import {ITreeStateContext} from "../db/api/beacon/stateContextCache";
import {AttestationError, AttestationErrorCode, BlockError, BlockErrorCode} from "./errors";
import {IBlockJob} from "./interface";
import {ChainEventEmitter, IChainEvents} from "./emitter";
import {BeaconChain} from "./chain";

interface IEventMap<Events, Key extends keyof Events = keyof Events, Value extends Events[Key] = Events[Key]>
  extends Map<Key, Value> {
  set<Key extends keyof Events>(key: Key, value: Events[Key]): this;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ListenerType<T> = [T] extends [(...args: infer U) => any] ? U : [T] extends [void] ? [] : [T];

/**
 * Returns a function that runs an async handler function with input args,
 * If the handler function successfully completes,
 * then emits the event on the event emitter using the same args
 */
function wrapHandler<
  Key extends keyof IChainEvents = keyof IChainEvents,
  Value extends IChainEvents[Key] = IChainEvents[Key]
>(event: Key, emitter: ChainEventEmitter, logger: ILogger, handler: (...args: Parameters<Value>) => Promise<void>) {
  return async (...args: Parameters<Value>): Promise<void> => {
    try {
      await handler(...args);
      emitter.emit(event, ...((args as unknown) as ListenerType<Value>));
    } catch (e) {
      logger.error(`Error handling event: ${event}`, e);
    }
  };
}

/**
 * Attach ChainEventEmitter event handlers
 * Listen on `signal` to remove event handlers
 *
 * Events are handled in the following way:
 * Because the chain relies on event handlers to perform side effects (eg: cache/db updates),
 * We require the chain's event handlers to run and complete in full before external event handlers are allowed to run.
 *
 * This is accomplished by maintaining a separate `chain.internalEmitter` and `chain.emitter`.
 * Chain submodules emit events on the `internalEmitter`, where chain event handlers are listening.
 * Once a chain event emitter is completed, the same event, with the same args, is emitted on `chain.emitter`, for consumption by external parties.
 */
export function handleChainEvents(this: BeaconChain, signal: AbortSignal): void {
  const handlers: IEventMap<IChainEvents> = new Map();
  const emitter = this.emitter;
  const logger = this.logger;
  handlers.set("clock:slot", wrapHandler("clock:slot", emitter, logger, onClockSlot.bind(this)));
  handlers.set("forkVersion", wrapHandler("forkVersion", emitter, logger, onForkVersion.bind(this)));
  handlers.set("checkpoint", wrapHandler("checkpoint", emitter, logger, onCheckpoint.bind(this)));
  handlers.set("justified", wrapHandler("justified", emitter, logger, onJustified.bind(this)));
  handlers.set("finalized", wrapHandler("finalized", emitter, logger, onFinalized.bind(this)));
  handlers.set(
    "forkChoice:justified",
    wrapHandler("forkChoice:justified", emitter, logger, onForkChoiceJustified.bind(this))
  );
  handlers.set(
    "forkChoice:finalized",
    wrapHandler("forkChoice:finalized", emitter, logger, onForkChoiceFinalized.bind(this))
  );
  handlers.set("forkChoice:head", wrapHandler("forkChoice:head", emitter, logger, onForkChoiceHead.bind(this)));
  handlers.set("forkChoice:reorg", wrapHandler("forkChoice:reorg", emitter, logger, onForkChoiceReorg.bind(this)));
  handlers.set("attestation", wrapHandler("attestation", emitter, logger, onAttestation.bind(this)));
  handlers.set("block", wrapHandler("block", emitter, logger, onBlock.bind(this)));
  handlers.set("error:attestation", wrapHandler("error:attestation", emitter, logger, onErrorAttestation.bind(this)));
  handlers.set("error:block", wrapHandler("error:block", emitter, logger, onErrorBlock.bind(this)));

  handlers.forEach((handler, event) => {
    this.internalEmitter.on(event, handler);
  });

  signal.addEventListener(
    "abort",
    () => {
      handlers.forEach((handler, event) => {
        this.internalEmitter.removeListener(event, handler);
      });
    },
    {once: true}
  );
}

export async function onClockSlot(this: BeaconChain, slot: Slot): Promise<void> {
  this.logger.verbose("Clock slot", {slot});
  this.forkChoice.updateTime(slot);
  await Promise.all(
    // Attestations can only affect the fork choice of subsequent slots.
    // Process the attestations in `slot - 1`, rather than `slot`
    this.pendingAttestations.getBySlot(slot - 1).map((job) => {
      this.pendingAttestations.remove(job);
      return this.attestationProcessor.processAttestationJob(job);
    })
  );
  await Promise.all(
    this.pendingBlocks.getBySlot(slot).map((job) => {
      this.pendingBlocks.remove(job);
      return this.blockProcessor.processBlockJob(job);
    })
  );
}

export async function onForkVersion(this: BeaconChain): Promise<void> {
  this._currentForkDigest = await this.getCurrentForkDigest();
  this.internalEmitter.emit("forkDigest", this._currentForkDigest);
}

export async function onCheckpoint(this: BeaconChain, cp: Checkpoint, stateContext: ITreeStateContext): Promise<void> {
  this.logger.verbose("Checkpoint processed", this.config.types.Checkpoint.toJson(cp));
  await this.db.checkpointStateCache.add(cp, stateContext);
  this.metrics.currentEpochLiveValidators.set(stateContext.epochCtx.currentShuffling.activeIndices.length);
  const parentBlockSummary = await this.forkChoice.getBlock(stateContext.state.latestBlockHeader.parentRoot);
  if (parentBlockSummary) {
    const justifiedCheckpoint = stateContext.state.currentJustifiedCheckpoint;
    const justifiedEpoch = justifiedCheckpoint.epoch;
    const preJustifiedEpoch = parentBlockSummary.justifiedEpoch;
    if (justifiedEpoch > preJustifiedEpoch) {
      this.internalEmitter.emit("justified", justifiedCheckpoint, stateContext);
    }
    const finalizedCheckpoint = stateContext.state.finalizedCheckpoint;
    const finalizedEpoch = finalizedCheckpoint.epoch;
    const preFinalizedEpoch = parentBlockSummary.finalizedEpoch;
    if (finalizedEpoch > preFinalizedEpoch) {
      this.internalEmitter.emit("finalized", finalizedCheckpoint, stateContext);
    }
  }
}

export async function onJustified(this: BeaconChain, cp: Checkpoint, stateContext: ITreeStateContext): Promise<void> {
  this.logger.important("Checkpoint justified", this.config.types.Checkpoint.toJson(cp));
  this.metrics.previousJustifiedEpoch.set(stateContext.state.previousJustifiedCheckpoint.epoch);
  this.metrics.currentJustifiedEpoch.set(cp.epoch);
}

export async function onFinalized(this: BeaconChain, cp: Checkpoint): Promise<void> {
  this.logger.important("Checkpoint finalized", this.config.types.Checkpoint.toJson(cp));
  this.metrics.currentFinalizedEpoch.set(cp.epoch);
}

export async function onForkChoiceJustified(this: BeaconChain, cp: Checkpoint): Promise<void> {
  this.logger.verbose("Fork choice justified", this.config.types.Checkpoint.toJson(cp));
}

export async function onForkChoiceFinalized(this: BeaconChain, cp: Checkpoint): Promise<void> {
  this.logger.verbose("Fork choice finalized", this.config.types.Checkpoint.toJson(cp));
}

export async function onForkChoiceHead(this: BeaconChain, head: IBlockSummary): Promise<void> {
  this.logger.verbose("New chain head", {
    headSlot: head.slot,
    headRoot: toHexString(head.blockRoot),
  });
}

export async function onForkChoiceReorg(
  this: BeaconChain,
  head: IBlockSummary,
  oldHead: IBlockSummary,
  depth: number
): Promise<void> {
  this.logger.verbose("Chain reorg", {
    depth,
  });
}

export async function onAttestation(this: BeaconChain, attestation: Attestation): Promise<void> {
  this.logger.debug("Attestation processed", {
    slot: attestation.data.slot,
    index: attestation.data.index,
    targetRoot: toHexString(attestation.data.target.root),
    aggregationBits: this.config.types.CommitteeBits.toJson(attestation.aggregationBits),
  });
}

export async function onBlock(
  this: BeaconChain,
  block: SignedBeaconBlock,
  postStateContext: ITreeStateContext,
  job: IBlockJob
): Promise<void> {
  const blockRoot = this.config.types.BeaconBlock.hashTreeRoot(block.message);
  this.logger.debug("Block processed", {
    slot: block.message.slot,
    root: toHexString(blockRoot),
  });
  this.metrics.currentSlot.set(block.message.slot);
  await this.db.stateCache.add(postStateContext);
  if (!job.reprocess) {
    await this.db.block.add(block);
  }
  if (!job.trusted) {
    // Only process attestations in response to an "untrusted" block
    await Promise.all([
      // process the attestations in the block
      ...readOnlyMap(block.message.body.attestations, (attestation) => {
        return this.attestationProcessor.processAttestationJob({
          attestation,
          // attestation signatures from blocks have already been verified
          validSignature: true,
        });
      }),
      // process pending attestations which needed the block
      ...this.pendingAttestations.getByBlock(blockRoot).map((job) => {
        this.pendingAttestations.remove(job);
        return this.attestationProcessor.processAttestationJob(job);
      }),
    ]);
  }
  await this.db.processBlockOperations(block);
  await Promise.all(
    this.pendingBlocks.getByParent(blockRoot).map((job) => {
      this.pendingBlocks.remove(job);
      return this.blockProcessor.processBlockJob(job);
    })
  );
}

export async function onErrorAttestation(this: BeaconChain, err: AttestationError): Promise<void> {
  if (!(err instanceof AttestationError)) {
    this.logger.error("Non AttestationError received:", err);
    return;
  }
  this.logger.debug("Attestation error", toJson(err));
  const attestationRoot = this.config.types.Attestation.hashTreeRoot(err.job.attestation);
  switch (err.type.code) {
    case AttestationErrorCode.ERR_FUTURE_SLOT:
      this.logger.debug("Add attestation to pool", {
        reason: err.type.code,
        attestationRoot: toHexString(attestationRoot),
      });
      this.pendingAttestations.putBySlot(err.type.attestationSlot, err.job);
      break;
    case AttestationErrorCode.ERR_UNKNOWN_TARGET_ROOT:
      this.logger.debug("Add attestation to pool", {
        reason: err.type.code,
        attestationRoot: toHexString(attestationRoot),
      });
      this.pendingAttestations.putByBlock(err.type.root, err.job);
      break;
    case AttestationErrorCode.ERR_UNKNOWN_HEAD_BLOCK:
      this.pendingAttestations.putByBlock(err.type.beaconBlockRoot, err.job);
      break;
    default:
      await this.db.attestation.remove(err.job.attestation);
  }
}

export async function onErrorBlock(this: BeaconChain, err: BlockError): Promise<void> {
  if (!(err instanceof BlockError)) {
    this.logger.error("Non BlockError received:", err);
    return;
  }
  this.logger.debug("Block error", toJson(err));
  const blockRoot = this.config.types.BeaconBlock.hashTreeRoot(err.job.signedBlock.message);
  switch (err.type.code) {
    case BlockErrorCode.ERR_FUTURE_SLOT:
      this.logger.debug("Add block to pool", {
        reason: err.type.code,
        blockRoot: toHexString(blockRoot),
      });
      this.pendingBlocks.addBySlot(err.job);
      break;
    case BlockErrorCode.ERR_PARENT_UNKNOWN:
      this.logger.debug("Add block to pool", {
        reason: err.type.code,
        blockRoot: toHexString(blockRoot),
      });
      this.pendingBlocks.addByParent(err.job);
      break;
    case BlockErrorCode.ERR_INCORRECT_PROPOSER:
    case BlockErrorCode.ERR_REPEAT_PROPOSAL:
    case BlockErrorCode.ERR_STATE_ROOT_MISMATCH:
    case BlockErrorCode.ERR_PER_BLOCK_PROCESSING_ERROR:
    case BlockErrorCode.ERR_BLOCK_IS_NOT_LATER_THAN_PARENT:
    case BlockErrorCode.ERR_UNKNOWN_PROPOSER:
      await this.db.badBlock.put(blockRoot);
      this.logger.warn("Found bad block", {
        blockRoot: toHexString(blockRoot),
        error: toJson(err),
      });
      break;
  }
}
