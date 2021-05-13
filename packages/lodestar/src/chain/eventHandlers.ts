import {AbortSignal} from "abort-controller";
import {readonlyValues, toHexString} from "@chainsafe/ssz";
import {allForks, phase0, Slot, Version} from "@chainsafe/lodestar-types";
import {ILogger} from "@chainsafe/lodestar-utils";
import {IBlockSummary} from "@chainsafe/lodestar-fork-choice";
import {CachedBeaconState} from "@chainsafe/lodestar-beacon-state-transition";

import {AttestationError, AttestationErrorCode, BlockError, BlockErrorCode} from "./errors";
import {IBlockJob} from "./interface";
import {ChainEvent, ChainEventEmitter, IChainEvents} from "./emitter";
import {BeaconChain} from "./chain";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ListenerType<T> = [T] extends [(...args: infer U) => any] ? U : [T] extends [void] ? [] : [T];
type AnyCallback = () => Promise<void>;

/**
 * Returns a function that runs an async handler function with input args,
 * If the handler function successfully completes,
 * then emits the event on the event emitter using the same args
 */
function wrapHandler<
  Event extends keyof IChainEvents = keyof IChainEvents,
  Callback extends IChainEvents[Event] = IChainEvents[Event]
>(
  event: Event,
  emitter: ChainEventEmitter,
  logger: ILogger,
  handler: (...args: Parameters<Callback>) => Promise<void> | void
) {
  return async (...args: Parameters<Callback>): Promise<void> => {
    try {
      await handler(...args);
      emitter.emit(event, ...((args as unknown) as ListenerType<Callback>));
    } catch (e) {
      logger.error("Error handling event", {event}, e);
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
  const handlersObj: {
    [K in keyof IChainEvents]: IChainEvents[K];
  } = {
    [ChainEvent.attestation]: onAttestation,
    [ChainEvent.block]: onBlock,
    [ChainEvent.checkpoint]: onCheckpoint,
    [ChainEvent.clockEpoch]: onClockEpoch,
    [ChainEvent.clockSlot]: onClockSlot,
    [ChainEvent.errorAttestation]: onErrorAttestation,
    [ChainEvent.errorBlock]: onErrorBlock,
    [ChainEvent.finalized]: onFinalized,
    [ChainEvent.forkChoiceFinalized]: onForkChoiceFinalized,
    [ChainEvent.forkChoiceHead]: onForkChoiceHead,
    [ChainEvent.forkChoiceJustified]: onForkChoiceJustified,
    [ChainEvent.forkChoiceReorg]: onForkChoiceReorg,
    [ChainEvent.forkVersion]: onForkVersion,
    [ChainEvent.justified]: onJustified,
  };

  const emitter = this.emitter;
  const logger = this.logger;
  const onAbort: (() => void)[] = [];

  for (const [eventStr, handler] of Object.entries(handlersObj)) {
    const event = eventStr as ChainEvent;
    const wrappedHandler = wrapHandler(event, emitter, logger, handler.bind(this) as AnyCallback) as AnyCallback;
    this.internalEmitter.on(event, wrappedHandler);
    onAbort.push(() => this.internalEmitter.off(event, wrappedHandler));
  }

  signal.addEventListener(
    "abort",
    () => {
      for (const fn of onAbort) fn();
    },
    {once: true}
  );
}

export async function onClockSlot(this: BeaconChain, slot: Slot): Promise<void> {
  this.logger.verbose("Clock slot", {slot});
  this.forkChoice.updateTime(slot);
  this.metrics?.clockSlot.set(slot);

  await Promise.all(
    // Attestations can only affect the fork choice of subsequent slots.
    // Process the attestations in `slot - 1`, rather than `slot`
    this.pendingAttestations.getBySlot(slot - 1).map((job) => {
      this.pendingAttestations.remove(job);
      return this.attestationProcessor.processAttestationJob(job);
    })
  );

  await Promise.all(
    this.pendingBlocks.getBySlot(slot).map(async (root) => {
      const pendingBlock = await this.db.pendingBlock.get(root);
      if (pendingBlock) {
        this.pendingBlocks.remove(pendingBlock);
        await this.db.pendingBlock.delete(root);
        return this.blockProcessor.processBlockJob({
          signedBlock: pendingBlock,
          reprocess: false,
          prefinalized: false,
          validSignatures: false,
          validProposerSignature: false,
        });
      }
    })
  );

  this.logger.debug("Block pools: ", {
    pendingBlocks: this.pendingBlocks.getTotalPendingBlocks(),
    currentSlot: this.clock.currentSlot,
  });
}

export function onClockEpoch(): void {
  //
}

export function onForkVersion(this: BeaconChain, version: Version): void {
  this.logger.verbose("New fork version", this.config.types.Version.toJson(version));
}

export function onCheckpoint(
  this: BeaconChain,
  cp: phase0.Checkpoint,
  state: CachedBeaconState<allForks.BeaconState>
): void {
  this.logger.verbose("Checkpoint processed", this.config.types.phase0.Checkpoint.toJson(cp));
  this.checkpointStateCache.add(cp, state);

  this.metrics?.currentValidators.set({status: "active"}, state.currentShuffling.activeIndices.length);
  const parentBlockSummary = this.forkChoice.getBlock(state.latestBlockHeader.parentRoot);

  if (parentBlockSummary) {
    const justifiedCheckpoint = state.currentJustifiedCheckpoint;
    const justifiedEpoch = justifiedCheckpoint.epoch;
    const preJustifiedEpoch = parentBlockSummary.justifiedEpoch;
    if (justifiedEpoch > preJustifiedEpoch) {
      this.internalEmitter.emit(ChainEvent.justified, justifiedCheckpoint, state);
    }
    const finalizedCheckpoint = state.finalizedCheckpoint;
    const finalizedEpoch = finalizedCheckpoint.epoch;
    const preFinalizedEpoch = parentBlockSummary.finalizedEpoch;
    if (finalizedEpoch > preFinalizedEpoch) {
      this.internalEmitter.emit(ChainEvent.finalized, finalizedCheckpoint, state);
    }
  }
}

export function onJustified(
  this: BeaconChain,
  cp: phase0.Checkpoint,
  state: CachedBeaconState<allForks.BeaconState>
): void {
  this.logger.verbose("Checkpoint justified", this.config.types.phase0.Checkpoint.toJson(cp));
  this.metrics?.previousJustifiedEpoch.set(state.previousJustifiedCheckpoint.epoch);
  this.metrics?.currentJustifiedEpoch.set(cp.epoch);
}

export function onFinalized(this: BeaconChain, cp: phase0.Checkpoint): void {
  this.logger.verbose("Checkpoint finalized", this.config.types.phase0.Checkpoint.toJson(cp));
  this.metrics?.finalizedEpoch.set(cp.epoch);
}

export function onForkChoiceJustified(this: BeaconChain, cp: phase0.Checkpoint): void {
  this.logger.verbose("Fork choice justified", this.config.types.phase0.Checkpoint.toJson(cp));
}

export function onForkChoiceFinalized(this: BeaconChain, cp: phase0.Checkpoint): void {
  this.logger.verbose("Fork choice finalized", this.config.types.phase0.Checkpoint.toJson(cp));
}

export function onForkChoiceHead(this: BeaconChain, head: IBlockSummary): void {
  this.logger.verbose("New chain head", {
    headSlot: head.slot,
    headRoot: toHexString(head.blockRoot),
  });
  this.metrics?.headSlot.set(head.slot);
}

export function onForkChoiceReorg(this: BeaconChain, head: IBlockSummary, oldHead: IBlockSummary, depth: number): void {
  this.logger.verbose("Chain reorg", {depth});
}

export function onAttestation(this: BeaconChain, attestation: phase0.Attestation): void {
  this.logger.debug("Attestation processed", {
    slot: attestation.data.slot,
    index: attestation.data.index,
    targetRoot: toHexString(attestation.data.target.root),
    aggregationBits: this.config.types.phase0.CommitteeBits.toJson(attestation.aggregationBits),
  });
}

export async function onBlock(
  this: BeaconChain,
  block: allForks.SignedBeaconBlock,
  postState: CachedBeaconState<allForks.BeaconState>,
  job: IBlockJob
): Promise<void> {
  const blockRoot = this.config.getTypes(block.message.slot).BeaconBlock.hashTreeRoot(block.message);
  this.logger.verbose("Block processed", {
    slot: block.message.slot,
    root: toHexString(blockRoot),
  });

  this.stateCache.add(postState);
  if (!job.reprocess) {
    await this.db.block.add(block);
  }

  if (!job.prefinalized) {
    // Only process attestations in response to an non-prefinalized block
    await Promise.all([
      // process the attestations in the block
      ...Array.from(readonlyValues(block.message.body.attestations), (attestation) => {
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
  // if reprocess job, don't have to reprocess block operations or pending blocks
  if (!job.reprocess) {
    await this.db.processBlockOperations(block);
    await Promise.all(
      this.pendingBlocks.getByParent(blockRoot).map(async (root) => {
        const pendingBlock = await this.db.pendingBlock.get(root);
        if (pendingBlock) {
          this.pendingBlocks.remove(pendingBlock);
          await this.db.pendingBlock.delete(root);
          return this.blockProcessor.processBlockJob({
            signedBlock: pendingBlock,
            reprocess: false,
            prefinalized: false,
            validSignatures: false,
            validProposerSignature: false,
          });
        }
      })
    );
  }
}

export async function onErrorAttestation(this: BeaconChain, err: AttestationError): Promise<void> {
  if (!(err instanceof AttestationError)) {
    this.logger.error("Non AttestationError received", {}, err);
    return;
  }

  this.logger.debug("Attestation error", {}, err);
  const attestationRoot = this.config.types.phase0.Attestation.hashTreeRoot(err.job.attestation);

  switch (err.type.code) {
    case AttestationErrorCode.FUTURE_SLOT:
      this.logger.debug("Add attestation to pool", {
        reason: err.type.code,
        attestationRoot: toHexString(attestationRoot),
      });
      this.pendingAttestations.putBySlot(err.type.attestationSlot, err.job);
      break;

    case AttestationErrorCode.UNKNOWN_TARGET_ROOT:
      this.logger.debug("Add attestation to pool", {
        reason: err.type.code,
        attestationRoot: toHexString(attestationRoot),
      });
      this.pendingAttestations.putByBlock(err.type.root, err.job);
      break;

    case AttestationErrorCode.UNKNOWN_BEACON_BLOCK_ROOT:
      this.pendingAttestations.putByBlock(err.type.beaconBlockRoot, err.job);
      break;

    default:
      await this.db.attestation.remove(err.job.attestation);
  }
}

export async function onErrorBlock(this: BeaconChain, err: BlockError): Promise<void> {
  if (!(err instanceof BlockError)) {
    this.logger.error("Non BlockError received", {}, err);
    return;
  }

  this.logger.error("Block error", {slot: err.job.signedBlock.message.slot}, err);
  const blockRoot = this.config
    .getTypes(err.job.signedBlock.message.slot)
    .BeaconBlock.hashTreeRoot(err.job.signedBlock.message);

  switch (err.type.code) {
    case BlockErrorCode.FUTURE_SLOT:
      this.logger.debug("Add block to pool", {
        reason: err.type.code,
        blockRoot: toHexString(blockRoot),
      });
      this.pendingBlocks.addBySlot(err.job.signedBlock);
      await this.db.pendingBlock.add(err.job.signedBlock);
      break;

    case BlockErrorCode.PARENT_UNKNOWN:
      this.logger.debug("Add block to pool", {
        reason: err.type.code,
        blockRoot: toHexString(blockRoot),
      });
      // add to pendingBlocks first which is not await
      // this is to process a block range
      this.pendingBlocks.addByParent(err.job.signedBlock);
      await this.db.pendingBlock.add(err.job.signedBlock);
      break;

    case BlockErrorCode.INCORRECT_PROPOSER:
    case BlockErrorCode.REPEAT_PROPOSAL:
    case BlockErrorCode.STATE_ROOT_MISMATCH:
    case BlockErrorCode.PER_BLOCK_PROCESSING_ERROR:
    case BlockErrorCode.BLOCK_IS_NOT_LATER_THAN_PARENT:
    case BlockErrorCode.UNKNOWN_PROPOSER:
      await this.db.badBlock.put(blockRoot);
      this.logger.warn("Found bad block", {blockRoot: toHexString(blockRoot)}, err);
      break;
  }
}
