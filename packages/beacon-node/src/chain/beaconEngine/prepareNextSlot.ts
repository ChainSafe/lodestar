import {routes} from "@lodestar/api";
import {ProtoBlock, getSafeExecutionBlockHash} from "@lodestar/fork-choice";
import {ForkPostBellatrix, ForkSeq, SLOTS_PER_EPOCH, isForkPostBellatrix} from "@lodestar/params";
import {
  IBeaconStateView,
  IBeaconStateViewBellatrix,
  StateHashTreeRootSource,
  computeEpochAtSlot,
  computeTimeAtSlot,
  isStatePostBellatrix,
  isStatePostGloas,
} from "@lodestar/state-transition";
import {Bytes32, Slot} from "@lodestar/types";
import {fromHex} from "@lodestar/utils";
import {ZERO_HASH_HEX} from "../../constants/constants.js";
import {BuilderStatus} from "../../execution/builder/http.js";
import {ForkchoiceCaller} from "../forkChoice/index.js";
import {getPayloadAttributesForSSE, prepareExecutionPayload} from "../produceBlock/produceBlockBody.js";
import {RegenCaller} from "../regen/index.js";
import type {BeaconEngine} from "./beaconEngine.js";
import {PrepareNextSlotResult} from "./interface.js";

/* We don't want to do more epoch transition than this */
const PREPARE_EPOCH_LIMIT = 1;

/**
 * Runs inside BeaconEngine. Moved from unstable@551b8b0a3d packages/beacon-node/src/chain/prepareNextSlot.ts#PrepareNextSlotScheduler.prepareForNextSlot.
 * Sync with that source on unstable merges; differences are tagged `[beacon-engine] deviation`.
 */
export async function prepareForNextSlot(this: BeaconEngine, clockSlot: Slot): Promise<PrepareNextSlotResult | null> {
  const prepareSlot = clockSlot + 1;
  const nextEpoch = computeEpochAtSlot(clockSlot) + 1;
  const isEpochTransition = computeEpochAtSlot(prepareSlot) === nextEpoch;
  const fork = this.config.getForkName(prepareSlot);
  // [beacon-engine] deviation: DA pruning remains in the facade.
  let daPruneParent: ProtoBlock | null = null;
  // calling updateHead() here before we produce a block to reduce reorg possibility
  const headBlock = this.recomputeForkChoiceHead(ForkchoiceCaller.prepareNextSlot);
  const {slot: headSlot, blockRoot: headRoot} = headBlock;
  // may be updated below if we predict a proposer-boost-reorg
  let updatedHead = headBlock;

  // PS: previously this was comparing slots, but that gave no leway on the skipped
  // slots on epoch bounday. Making it more fluid.
  if (prepareSlot - headSlot > PREPARE_EPOCH_LIMIT * SLOTS_PER_EPOCH) {
    this.metrics?.precomputeNextEpochTransition.count.inc({result: "skip"}, 1);
    this.logger.debug("Skipping PrepareNextSlotScheduler - head slot is too behind current slot", {
      nextEpoch,
      headSlot,
      clockSlot,
    });

    // [beacon-engine] deviation: skipped preparation returns no facade work.
    return null;
  }

  this.logger.verbose("Running prepareForNextSlot", {
    nextEpoch,
    prepareSlot,
    headSlot,
    headRoot,
    isEpochTransition,
  });
  const precomputeEpochTransitionTimer = isEpochTransition
    ? this.metrics?.precomputeNextEpochTransition.duration.startTimer()
    : null;
  const start = Date.now();
  // No need to wait for this or the clock drift
  // Pre Bellatrix: we only do precompute state transition for the last slot of epoch
  // For Bellatrix, we always do the `processSlots()` to prepare payload for the next slot
  const prepareState = await this.regen.getBlockSlotState(
    headBlock,
    prepareSlot,
    // the slot 0 of next epoch will likely use this Previous Root Checkpoint state for state transition so we transfer cache here
    // the resulting state with cache will be cached in Checkpoint State Cache which is used for the upcoming block processing
    // for other slots dontTransferCached=true because we don't run state transition on this state
    {dontTransferCache: !isEpochTransition},
    RegenCaller.precomputeEpoch
  );

  if (isForkPostBellatrix(fork)) {
    const proposerIndex = prepareState.getBeaconProposer(prepareSlot);
    const feeRecipient = this.beaconProposerCache.get(proposerIndex);
    let updatedPrepareState = prepareState;

    if (feeRecipient) {
      // If we are proposing next slot, we need to predict if we can proposer-boost-reorg or not
      const proposerHead = this.predictProposerHead(clockSlot);
      const {slot: proposerHeadSlot, blockRoot: proposerHeadRoot} = proposerHead;

      // If we predict we can reorg, update prepareState with proposer head block
      if (proposerHeadRoot !== headRoot || proposerHeadSlot !== headSlot) {
        this.logger.verbose("Weak head detected. May build on parent block instead", {
          proposerHeadSlot,
          proposerHeadRoot,
          headSlot,
          headRoot,
        });
        this.metrics?.weakHeadDetected.inc();
        updatedPrepareState = await this.regen.getBlockSlotState(
          proposerHead,
          prepareSlot,
          // only transfer cache if epoch transition because that's the state we will use to stateTransition() the 1st block of epoch
          {dontTransferCache: !isEpochTransition},
          RegenCaller.predictProposerHead
        );
        updatedHead = proposerHead;
      }

      // Update the builder status, if enabled shoot an api call to check status
      this.updateBuilderStatus(clockSlot);
      if (this.executionBuilder?.status === BuilderStatus.enabled) {
        this.executionBuilder.checkStatus().catch((e) => {
          this.logger.error("Builder disabled as the check status api failed", {prepareSlot}, e as Error);
        });
      }
    }

    if (!isStatePostBellatrix(updatedPrepareState)) {
      throw new Error("Expected Bellatrix state for payload attributes");
    }

    let parentBlockHash: Bytes32;
    // Apply parent payload once here as it's reused by EL prep and SSE emit below
    let stateAfterParentPayload: IBeaconStateViewBellatrix = updatedPrepareState;
    if (isStatePostGloas(updatedPrepareState)) {
      // Spec: should_build_on_full(store, head) — see produceBlockBody.ts for context.
      if (this.forkChoice.shouldBuildOnFull(updatedHead, prepareSlot)) {
        parentBlockHash = updatedPrepareState.latestExecutionPayloadBid.blockHash;
        // Skip applying parent payload unless we're proposing the next slot or have to emit payload_attributes events
        if (feeRecipient !== undefined || this.opts.emitPayloadAttributes === true) {
          const parentExecutionRequests = await this.getParentExecutionRequests(
            updatedHead.slot,
            updatedHead.blockRoot
          );
          stateAfterParentPayload = updatedPrepareState.withParentPayloadApplied(parentExecutionRequests);
        }
      } else {
        parentBlockHash = updatedPrepareState.latestExecutionPayloadBid.parentBlockHash;
      }
    } else {
      parentBlockHash = updatedPrepareState.latestExecutionPayloadHeader.blockHash;
    }

    if (feeRecipient) {
      const preparationTime = computeTimeAtSlot(this.config, prepareSlot, this.genesisTime) - Date.now() / 1000;
      this.metrics?.blockPayload.payloadAdvancePrepTime.observe(preparationTime);

      const safeBlockHash = getSafeExecutionBlockHash(this.forkChoice);
      const finalizedBlockHash = this.forkChoice.getFinalizedBlock().executionPayloadBlockHash ?? ZERO_HASH_HEX;

      // awaiting here instead of throwing an async call because there is no other task
      // left for scheduler and this gives nice semantics to catch and log errors in the
      // try/catch wrapper here.
      await prepareExecutionPayload(
        this,
        this.logger,
        fork as ForkPostBellatrix, // State is of execution type
        fromHex(updatedHead.blockRoot),
        parentBlockHash,
        safeBlockHash,
        finalizedBlockHash,
        stateAfterParentPayload,
        feeRecipient
      );
      this.logger.verbose("PrepareNextSlotScheduler prepared new payload", {
        prepareSlot,
        proposerIndex,
        feeRecipient,
      });
    }

    if (ForkSeq[fork] >= ForkSeq.gloas) {
      // Cutoff = slot of the parent of the block we'll actually build on (post-reorg).
      // Steady state: cache holds just 2 entries — head (parent for next-slot production)
      // and head.parent (proposer-boost-reorg fallback). Anything older is evicted.
      const updatedHeadParent = this.forkChoice.getBlockHexDefaultStatus(updatedHead.parentRoot);
      if (updatedHeadParent) {
        // [beacon-engine] deviation: return the DA prune parent to the facade.
        daPruneParent = updatedHeadParent;
      }
    }

    computeStateHashTreeRoot.call(this, updatedPrepareState, isEpochTransition);

    // If emitPayloadAttributes is true emit a SSE payloadAttributes event for
    // every slot. Without the flag, only emit the event if we are proposing in the next slot.
    if (
      (feeRecipient || this.opts.emitPayloadAttributes === true) &&
      this.emitter.listenerCount(routes.events.EventType.payloadAttributes)
    ) {
      const data = getPayloadAttributesForSSE(fork as ForkPostBellatrix, this, {
        prepareState: stateAfterParentPayload,
        prepareSlot,
        parentBlockRoot: fromHex(updatedHead.blockRoot),
        parentBlockHash,
        feeRecipient: feeRecipient ?? "0x0000000000000000000000000000000000000000",
      });
      this.emitter.emit(routes.events.EventType.payloadAttributes, {data, version: fork});
    }
  } else {
    computeStateHashTreeRoot.call(this, prepareState, isEpochTransition);
  }

  // assuming there is no reorg, it caches the checkpoint state & helps avoid doing a full state transition in the next slot
  //  + when gossip block comes, we need to validate and run state transition
  //  + if next slot is a skipped slot, it'd help getting target checkpoint state faster to validate attestations
  if (isEpochTransition) {
    this.metrics?.precomputeNextEpochTransition.count.inc({result: "success"}, 1);
    const previousHits = this.regen.updatePreComputedCheckpoint(headRoot, nextEpoch);
    if (previousHits === 0) {
      this.metrics?.precomputeNextEpochTransition.waste.inc();
    }
    this.metrics?.precomputeNextEpochTransition.hits.set(previousHits ?? 0);

    this.logger.verbose("Completed PrepareNextSlotScheduler epoch transition", {
      nextEpoch,
      headSlot,
      prepareSlot,
      previousHits,
      durationMs: Date.now() - start,
    });

    precomputeEpochTransitionTimer?.();
  }
  // [beacon-engine] deviation: return only the facade-owned DA work.
  return daPruneParent ? {daPruneParent} : null;
}

/**
 * Runs inside BeaconEngine. Moved from unstable@551b8b0a3d packages/beacon-node/src/chain/prepareNextSlot.ts#computeStateHashTreeRoot.
 * Sync with that source on unstable merges; differences are tagged `[beacon-engine] deviation`.
 */
export function computeStateHashTreeRoot(
  this: BeaconEngine,
  state: IBeaconStateView,
  isEpochTransition: boolean
): void {
  // cache HashObjects for faster hashTreeRoot() later, especially for computeNewStateRoot() if we need to produce a block at slot 0 of epoch
  // see https://github.com/ChainSafe/lodestar/issues/6194
  const hashTreeRootTimer = this.metrics?.stateHashTreeRootTime.startTimer({
    source: isEpochTransition ? StateHashTreeRootSource.prepareNextEpoch : StateHashTreeRootSource.prepareNextSlot,
  });
  state.hashTreeRoot();
  hashTreeRootTimer?.();
}
