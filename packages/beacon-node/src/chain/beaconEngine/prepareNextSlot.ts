import {routes} from "@lodestar/api";
import {getFinalizedExecutionBlockHash, getSafeExecutionBlockHash} from "@lodestar/fork-choice";
import {
  ForkPostBellatrix,
  ForkSeq,
  SLOTS_PER_EPOCH,
  isForkPostBellatrix,
  isForkPostFulu,
  isForkPostGloas,
} from "@lodestar/params";
import {
  GLOAS_PREVERIFY_WINDOW_EPOCHS,
  IBeaconStateView,
  IBeaconStateViewBellatrix,
  MAX_BUILDER_DEPOSITS_PER_SLOT,
  StateHashTreeRootSource,
  computeEpochAtSlot,
  computeTimeAtSlot,
  isStatePostBellatrix,
  isStatePostFulu,
  isStatePostGloas,
} from "@lodestar/state-transition";
import {Bytes32, Slot, ValidatorIndex} from "@lodestar/types";
import {fromHex, isErrorAborted, sleep} from "@lodestar/utils";
import {GENESIS_SLOT} from "../../constants/constants.js";
import {BuilderStatus} from "../../execution/builder/http.js";
import {PayloadAttributes} from "../../execution/index.js";
import {ForkchoiceCaller} from "../forkChoice/index.js";
import {getPayloadAttributesForSSE, prepareExecutionPayload} from "../produceBlock/produceBlockBody.js";
import {RegenCaller} from "../regen/index.js";
import type {BeaconEngine} from "./beaconEngine.js";
/** Runs inside BeaconEngine. Moved from unstable@6fb6c0bad4 packages/beacon-node/src/chain/prepareNextSlot.ts#PrepareNextSlotScheduler.prepareForNextSlot. */
export async function prepareForNextSlot(this: BeaconEngine, clockSlot: Slot): Promise<null> {
  const prepareSlot = clockSlot + 1;
  const prepareEpoch = computeEpochAtSlot(prepareSlot);
  const nextEpoch = computeEpochAtSlot(clockSlot) + 1;
  const isEpochTransition = prepareEpoch === nextEpoch;
  const fork = this.config.getForkName(prepareSlot);
  if (prepareSlot <= GENESIS_SLOT || (ForkSeq[fork] < ForkSeq.bellatrix && !isEpochTransition)) {
    return null;
  }
  const headBlock = this.recomputeForkChoiceHead(ForkchoiceCaller.prepareNextSlot);
  const {slot: headSlot, blockRoot: headRoot} = headBlock;
  let updatedHead = headBlock;
  if (prepareSlot - headSlot > PREPARE_EPOCH_LIMIT * SLOTS_PER_EPOCH) {
    this.metrics?.precomputeNextEpochTransition.count.inc({result: "skip"}, 1);
    this.logger.debug("Skipping PrepareNextSlotScheduler - head slot is too behind current slot", {
      nextEpoch,
      headSlot,
      clockSlot,
    });

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
  let feeRecipient: string | undefined;
  if (isForkPostBellatrix(fork)) {
    let preparedState: IBeaconStateView | undefined;

    const getProposerIndex = async (): Promise<ValidatorIndex> => {
      if (isForkPostFulu(fork)) {
        // getBeaconProposer covers the current + next epoch; should not throw
        // PROPOSER_EPOCH_MISMATCH here due to the PREPARE_EPOCH_LIMIT check above.
        return this.getHeadState().getBeaconProposer(prepareSlot);
      }
      // the slot 0 of next epoch will likely use this Previous Root Checkpoint state for state transition so we transfer cache here
      // the resulting state with cache will be cached in Checkpoint State Cache which is used for the upcoming block processing
      // for other slots dontTransferCached=true because we don't run state transition on this state
      preparedState = await this.regen.getBlockSlotState(
        headBlock,
        prepareSlot,
        {dontTransferCache: !isEpochTransition},
        RegenCaller.precomputeEpoch
      );
      return preparedState.getBeaconProposer(prepareSlot);
    };

    const proposerIndex = await getProposerIndex();
    feeRecipient = this.beaconProposerCache.get(proposerIndex);

    // Predict the proposer head of the next slot when either:
    //  - we are proposing the next slot (single-slot proposer-boost-reorg), or
    //  - this is an epoch transition: post-Fulu the next proposer may reorg a weak
    //    last-block-of-epoch and build slot 0 on the strong parent (epoch-boundary reorg),
    //    so we should dial the strong parent through the boundary instead of the weak head.
    if (feeRecipient || isEpochTransition) {
      const proposerHead = this.predictProposerHead();
      const {slot: proposerHeadSlot, blockRoot: proposerHeadRoot} = proposerHead;

      // If we predict a reorg, we build the epoch transition on the proposer head (parent) instead
      if (proposerHeadRoot !== headRoot || proposerHeadSlot !== headSlot) {
        // feeRecipient set => WE propose the next slot and may reorg it out ourselves;
        // otherwise it's a predicted reorg by another proposer (epoch-boundary reorg).
        const logMessage = feeRecipient
          ? "Weak head detected. We may build on parent block instead"
          : "Weak head detected. Another proposer may build on parent block instead";
        this.logger.verbose(logMessage, {
          proposerHeadSlot,
          proposerHeadRoot,
          headSlot,
          headRoot,
          isEpochTransition,
        });
        this.metrics?.weakHeadDetected.inc();
        if (isEpochTransition) {
          this.metrics?.precomputeNextEpochTransition.predictedReorg.inc();
        }
        updatedHead = proposerHead;
      }
    }

    if (feeRecipient) {
      if (isForkPostGloas(fork)) {
        this.builderCircuitBreaker.update(clockSlot, updatedHead);
        checkBuilderStatusBeforeSlot.call(this, prepareSlot);
      } else {
        // Update the builder status, if enabled shoot an api call to check status
        this.updateBuilderStatus(clockSlot);
        if (this.executionBuilder?.status === BuilderStatus.enabled) {
          this.executionBuilder.checkStatus().catch((e) => {
            this.logger.error("Builder disabled as the check status api failed", {prepareSlot}, e as Error);
          });
        }
      }
    }

    // post-fulu we'll always reach here because preparedState is undefined
    // we may run epoch transition not with headBlock if it's weak
    if (preparedState === undefined || updatedHead !== headBlock) {
      preparedState = await this.regen.getBlockSlotState(
        updatedHead,
        prepareSlot,
        // only transfer cache if epoch transition because that's the state we will use to stateTransition() the 1st block of epoch
        {dontTransferCache: !isEpochTransition},
        updatedHead === headBlock ? RegenCaller.precomputeEpoch : RegenCaller.predictProposerHead
      );
    }

    if (!isStatePostBellatrix(preparedState)) {
      throw new Error("Expected Bellatrix state for payload attributes");
    }

    let parentBlockHash: Bytes32;
    // Apply parent payload once here as it's reused by EL prep and SSE emit below
    let stateAfterParentPayload: IBeaconStateViewBellatrix = preparedState;
    if (isStatePostGloas(preparedState)) {
      // Spec: should_build_on_full(store, head, slot) - see produceBlockBody.ts for context.
      if (this.forkChoice.shouldBuildOnFull(updatedHead, prepareSlot)) {
        parentBlockHash = preparedState.latestExecutionPayloadBid.blockHash;
        // Skip applying parent payload unless we're proposing the next slot or have to emit payload_attributes events
        if (feeRecipient !== undefined || this.opts.emitPayloadAttributes === true) {
          const parentExecutionRequests = await this.getParentExecutionRequests(
            updatedHead.slot,
            updatedHead.blockRoot
          );
          stateAfterParentPayload = preparedState.withParentPayloadApplied(parentExecutionRequests);
        }
      } else {
        parentBlockHash = preparedState.latestExecutionPayloadBid.parentBlockHash;
      }
    } else {
      parentBlockHash = preparedState.latestExecutionPayloadHeader.blockHash;
    }

    const safeBlockHash = getSafeExecutionBlockHash(this.forkChoice, this.logger);
    const finalizedBlockHash = getFinalizedExecutionBlockHash(this.forkChoice);

    let payloadAttributes: PayloadAttributes | undefined;
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
        safeBlockHash,
        finalizedBlockHash,
        feeRecipient: feeRecipient ?? "0x0000000000000000000000000000000000000000",
      });
      this.emitter.emit(routes.events.EventType.payloadAttributes, {data, version: fork});
      payloadAttributes = data.payloadAttributes;
    }

    if (feeRecipient) {
      const preparationTime = computeTimeAtSlot(this.config, prepareSlot, this.genesisTime) - Date.now() / 1000;
      this.metrics?.blockPayload.payloadAdvancePrepTime.observe(preparationTime);

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
        feeRecipient,
        payloadAttributes
      );
      this.logger.verbose("PrepareNextSlotScheduler prepared new payload", {
        prepareSlot,
        proposerIndex,
        feeRecipient,
      });
    }

    computeStateHashTreeRoot.call(this, preparedState, isEpochTransition);
  } else {
    // Pre-bellatrix only reaches here at an epoch transition to precompute the next epoch state
    const preparedState = await this.regen.getBlockSlotState(
      headBlock,
      prepareSlot,
      {dontTransferCache: !isEpochTransition},
      RegenCaller.precomputeEpoch
    );
    computeStateHashTreeRoot.call(this, preparedState, isEpochTransition);
  }
  if (isEpochTransition) {
    this.metrics?.precomputeNextEpochTransition.count.inc({result: "success"}, 1);
    const previousHits = this.regen.updatePreComputedCheckpoint(updatedHead.blockRoot, nextEpoch);
    if (previousHits === 0) {
      this.metrics?.precomputeNextEpochTransition.waste.inc();
    }
    this.metrics?.precomputeNextEpochTransition.hits.set(previousHits ?? 0);

    this.logger.verbose("Completed PrepareNextSlotScheduler epoch transition", {
      nextEpoch,
      headSlot,
      headRoot,
      updatedHeadRoot: updatedHead.blockRoot,
      prepareSlot,
      previousHits,
      durationMs: Date.now() - start,
    });

    precomputeEpochTransitionTimer?.();

    // Nothing more to do on an epoch-transition slot: that precompute already ran a full (>1s)
    // epoch transition, so we don't pile the builder-deposit pre-verify (below) on top of it.
    return null;
  }
  const headState = this.getHeadState();
  if (isStatePostFulu(headState)) {
    const gloasEpoch = this.config.GLOAS_FORK_EPOCH;
    const finalizedEpoch = this.forkChoice.getFinalizedCheckpoint().epoch;
    if (finalizedEpoch >= gloasEpoch) {
      // Gloas is finalized — the pre-verify cache has served its purpose; release its memory.
      headState.clearPreGloasBuilderDepositCache();
    } else {
      const clockEpoch = computeEpochAtSlot(clockSlot);
      if (
        ForkSeq[fork] < ForkSeq.gloas && // only before the fork
        clockEpoch >= gloasEpoch - GLOAS_PREVERIFY_WINDOW_EPOCHS && // Infinity when Gloas unscheduled → skip
        clockEpoch < gloasEpoch &&
        // skip when we're the next-slot proposer — don't compete with block-production prep.
        feeRecipient === undefined
      ) {
        const maxDurationMs = this.config.getSlotComponentDurationMs(BUILDER_PREVERIFY_LIMIT_BPS);
        const preVerifyTimer = this.metrics?.builderDepositPreVerify.duration.startTimer();
        const result = headState.preVerifyBuilderDepositsPreGloas(MAX_BUILDER_DEPOSITS_PER_SLOT, maxDurationMs);
        preVerifyTimer?.();

        const preVerifyMetrics = this.metrics?.builderDepositPreVerify;
        if (preVerifyMetrics) {
          preVerifyMetrics.pendingDeposits.set(result.pendingDepositsCount);
          preVerifyMetrics.cachedDeposits.set(result.totalCachedDeposits);
          preVerifyMetrics.scannedDeposits.set(result.scannedPendingDeposits);
          preVerifyMetrics.builderPubkeys.set(result.totalBuilderPubkeys);
          if (result.validBuilderSignaturesCount > 0) {
            preVerifyMetrics.validSignatures.inc({type: "builder"}, result.validBuilderSignaturesCount);
          }
          if (result.validValidatorSignaturesCount > 0) {
            preVerifyMetrics.validSignatures.inc({type: "validator"}, result.validValidatorSignaturesCount);
          }
          if (result.invalidBuilderSignaturesCount > 0) {
            preVerifyMetrics.invalidSignatures.inc({type: "builder"}, result.invalidBuilderSignaturesCount);
          }
          if (result.invalidValidatorSignaturesCount > 0) {
            preVerifyMetrics.invalidSignatures.inc({type: "validator"}, result.invalidValidatorSignaturesCount);
          }
        }

        // Always log (once per slot, only within the pre-fork window) so devnets show the
        // pre-verify draining even on all-cache-hit ticks.
        this.logger.verbose("PrepareNextSlotScheduler pre-verified deposit signatures", {
          clockSlot,
          validBuilderSignaturesCount: result.validBuilderSignaturesCount,
          invalidBuilderSignaturesCount: result.invalidBuilderSignaturesCount,
          validValidatorSignaturesCount: result.validValidatorSignaturesCount,
          invalidValidatorSignaturesCount: result.invalidValidatorSignaturesCount,
          scannedPendingDeposits: result.scannedPendingDeposits,
          totalCachedDeposits: result.totalCachedDeposits,
          totalBuilderPubkeys: result.totalBuilderPubkeys,
          pendingDepositsCount: result.pendingDepositsCount,
        });
      }
    }
  }
  return null;
}

/** Runs inside BeaconEngine. Moved from unstable@6fb6c0bad4 packages/beacon-node/src/chain/prepareNextSlot.ts#checkBuilderStatusBeforeSlot. */
function checkBuilderStatusBeforeSlot(this: BeaconEngine, prepareSlot: Slot): void {
  const msBeforeSlot = this.config.getSlotComponentDurationMs(BUILDER_STATUS_CHECK_BEFORE_SLOT_BPS);
  const msUntilCheck = -this.clock.msFromSlot(prepareSlot) - msBeforeSlot;
  sleep(Math.max(0, msUntilCheck), this.signal)
    .then(() => this.builderApiClient.checkStatus())
    .catch((e) => {
      if (!isErrorAborted(e)) {
        this.logger.debug("Failed to check builder status", {prepareSlot}, e as Error);
      }
    });
}

/** Runs inside BeaconEngine. Moved from unstable@6fb6c0bad4 packages/beacon-node/src/chain/prepareNextSlot.ts#computeStateHashTreeRoot. */
function computeStateHashTreeRoot(this: BeaconEngine, state: IBeaconStateView, isEpochTransition: boolean): void {
  // cache HashObjects for faster hashTreeRoot() later, especially for computeNewStateRoot() if we need to produce a block at slot 0 of epoch
  // see https://github.com/ChainSafe/lodestar/issues/6194
  const hashTreeRootTimer = this.metrics?.stateHashTreeRootTime.startTimer({
    source: isEpochTransition ? StateHashTreeRootSource.prepareNextEpoch : StateHashTreeRootSource.prepareNextSlot,
  });
  state.hashTreeRoot();
  hashTreeRootTimer?.();
}
export const PREPARE_NEXT_SLOT_BPS = 6667;
const PREPARE_EPOCH_LIMIT = 1;
const BUILDER_PREVERIFY_LIMIT_BPS = 2000;
const BUILDER_STATUS_CHECK_BEFORE_SLOT_BPS = 1667;
