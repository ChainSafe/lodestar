import {AbortSignal} from "@chainsafe/abort-controller";
import {readonlyValues, toHexString, TreeBacked} from "@chainsafe/ssz";
import {allForks, altair, Epoch, phase0, Slot, ssz, Version} from "@chainsafe/lodestar-types";
import {ILogger} from "@chainsafe/lodestar-utils";
import {IBlockSummary} from "@chainsafe/lodestar-fork-choice";
import {CachedBeaconState, computeEpochAtSlot} from "@chainsafe/lodestar-beacon-state-transition";

import {AttestationError, BlockError, BlockErrorCode} from "./errors";
import {IBlockJob} from "./interface";
import {ChainEvent, ChainEventEmitter, IChainEvents} from "./emitter";
import {BeaconChain} from "./chain";
import {RegenCaller} from "./regen";

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

  this.attestationPool.prune(slot);
  this.aggregatedAttestationPool.prune(slot);
  this.syncCommitteeMessagePool.prune(slot);
  this.seenSyncCommitteeMessages.prune(slot);

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

export function onClockEpoch(this: BeaconChain, currentEpoch: Epoch): void {
  this.seenAttesters.prune(currentEpoch);
  this.seenAggregators.prune(currentEpoch);
}

export function onForkVersion(this: BeaconChain, version: Version): void {
  this.logger.verbose("New fork version", ssz.Version.toJson(version));
}

export function onCheckpoint(
  this: BeaconChain,
  cp: phase0.Checkpoint,
  state: CachedBeaconState<allForks.BeaconState>
): void {
  this.logger.verbose("Checkpoint processed", ssz.phase0.Checkpoint.toJson(cp));
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
  this.logger.verbose("Checkpoint justified", ssz.phase0.Checkpoint.toJson(cp));
  this.metrics?.previousJustifiedEpoch.set(state.previousJustifiedCheckpoint.epoch);
  this.metrics?.currentJustifiedEpoch.set(cp.epoch);
}

export async function onFinalized(this: BeaconChain, cp: phase0.Checkpoint): Promise<void> {
  this.logger.verbose("Checkpoint finalized", ssz.phase0.Checkpoint.toJson(cp));
  this.metrics?.finalizedEpoch.set(cp.epoch);
}

export function onForkChoiceJustified(this: BeaconChain, cp: phase0.Checkpoint): void {
  this.logger.verbose("Fork choice justified", ssz.phase0.Checkpoint.toJson(cp));
}

export async function onForkChoiceFinalized(this: BeaconChain, cp: phase0.Checkpoint): Promise<void> {
  this.logger.verbose("Fork choice finalized", ssz.phase0.Checkpoint.toJson(cp));
  // Only after altair
  if (cp.epoch >= this.config.ALTAIR_FORK_EPOCH) {
    try {
      const state = await this.regen.getCheckpointState(cp, RegenCaller.onForkChoiceFinalized);
      // using state.slot is not correct for a checkpoint with skipped slot
      const block = await this.getCanonicalBlockAtSlot(state.latestBlockHeader.slot);
      if (!block) {
        throw Error(`No block found for checkpoint ${cp.epoch} : ${toHexString(cp.root)}`);
      }

      await this.lightclientUpdater.onFinalized(
        cp,
        block.message as altair.BeaconBlock,
        state as TreeBacked<altair.BeaconState>
      );
    } catch (e) {
      this.logger.error("Error lightclientUpdater.onFinalized", {epoch: cp.epoch}, e);
    }
    try {
      await this.lightClientIniter.onFinalized(cp);
    } catch (e) {
      this.logger.error("Error LightClientIniter.onFinalized", {epoch: cp.epoch}, e);
    }
  }
}

export function onForkChoiceHead(this: BeaconChain, head: IBlockSummary): void {
  this.logger.verbose("New chain head", {
    headSlot: head.slot,
    headRoot: toHexString(head.blockRoot),
  });
  this.syncContributionAndProofPool.prune(head.slot);
  this.seenContributionAndProof.prune(head.slot);
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
    aggregationBits: ssz.phase0.CommitteeBits.toJson(attestation.aggregationBits),
  });
}

export async function onBlock(
  this: BeaconChain,
  block: allForks.SignedBeaconBlock,
  postState: CachedBeaconState<allForks.BeaconState>,
  job: IBlockJob
): Promise<void> {
  const blockRoot = this.config.getForkTypes(block.message.slot).BeaconBlock.hashTreeRoot(block.message);
  this.logger.verbose("Block processed", {
    slot: block.message.slot,
    root: toHexString(blockRoot),
  });

  this.stateCache.add(postState);
  if (!job.reprocess) {
    await this.db.block.add(block);
  }

  // Only process attestations in response to an non-prefinalized block
  if (!job.prefinalized) {
    const attestations = Array.from(readonlyValues(block.message.body.attestations));

    for (const attestation of attestations) {
      try {
        const indexedAttestation = postState.epochCtx.getIndexedAttestation(attestation);
        this.forkChoice.onAttestation(indexedAttestation);
        this.emitter.emit(ChainEvent.attestation, attestation);

        this.metrics?.registerAttestationInBlock(indexedAttestation, block.message);
      } catch (e) {
        this.logger.error("Error processing attestation from block", {slot: block.message.slot}, e);
      }
    }
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

  // Only after altair
  if (computeEpochAtSlot(block.message.slot) >= this.config.ALTAIR_FORK_EPOCH) {
    try {
      await this.lightclientUpdater.onHead(
        block.message as altair.BeaconBlock,
        postState as TreeBacked<altair.BeaconState>
      );
    } catch (e) {
      this.logger.error("Error lightclientUpdater.onHead", {slot: block.message.slot}, e);
    }
  }
}

export async function onErrorAttestation(this: BeaconChain, err: AttestationError): Promise<void> {
  if (!(err instanceof AttestationError)) {
    this.logger.error("Non AttestationError received", {}, err);
    return;
  }

  this.logger.debug("Attestation error", {}, err);
}

export async function onErrorBlock(this: BeaconChain, err: BlockError): Promise<void> {
  if (!(err instanceof BlockError)) {
    this.logger.error("Non BlockError received", {}, err);
    return;
  }

  // err type data may contain CachedBeaconState which is too much to log
  this.logger.error("Block error", {slot: err.signedBlock.message.slot, errCode: err.type.code});

  if (err.type.code === BlockErrorCode.FUTURE_SLOT) {
    this.pendingBlocks.addBySlot(err.signedBlock);
    await this.db.pendingBlock.add(err.signedBlock);
  }

  // add to pendingBlocks first which is not await
  // this is to process a block range
  else if (err.type.code === BlockErrorCode.PARENT_UNKNOWN) {
    this.pendingBlocks.addByParent(err.signedBlock);
    await this.db.pendingBlock.add(err.signedBlock);
  } else if (err.type.code === BlockErrorCode.INVALID_SIGNATURE) {
    const {signedBlock} = err;
    const blockSlot = signedBlock.message.slot;
    const {preState} = err.type;
    const blockPath = this.persistInvalidSszObject(
      "signedBlock",
      this.config.getForkTypes(blockSlot).SignedBeaconBlock.serialize(signedBlock),
      `${blockSlot}_invalid_signature`
    );
    const statePath = this.persistInvalidSszObject("state", preState.serialize(), `${preState.slot}_invalid_signature`);
    this.logger.debug("Invalid signature block and state were written to disc", {blockPath, statePath});
  } else if (err.type.code === BlockErrorCode.INVALID_STATE_ROOT) {
    const {signedBlock} = err;
    const blockSlot = signedBlock.message.slot;
    const {preState, postState} = err.type;
    const invalidRoot = toHexString(postState.hashTreeRoot());
    const blockPath = this.persistInvalidSszObject(
      "signedBlock",
      this.config.getForkTypes(blockSlot).SignedBeaconBlock.serialize(signedBlock),
      `${blockSlot}_invalid_state_root_${invalidRoot}`
    );
    const preStatePath = this.persistInvalidSszObject(
      "state",
      preState.serialize(),
      `${preState.slot}_invalid_state_root_preState_${invalidRoot}`
    );
    const postStatePath = this.persistInvalidSszObject(
      "state",
      postState.serialize(),
      `${postState.slot}_invalid_state_root_postState_${invalidRoot}`
    );
    this.logger.debug("Invalid signature block and state were written to disc", {
      blockPath,
      preStatePath,
      postStatePath,
    });
  }
}
