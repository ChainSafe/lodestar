import {routes} from "@lodestar/api";
import {ChainForkConfig} from "@lodestar/config";
import {
  ProtoBlock,
  PtcQuorumEvent,
  getFinalizedExecutionBlockHash,
  getSafeExecutionBlockHash,
} from "@lodestar/fork-choice";
import {
  ForkName,
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
import {Bytes32, RootHex, Slot, ValidatorIndex} from "@lodestar/types";
import {Logger, fromHex, isErrorAborted, sleep, toHex} from "@lodestar/utils";
import {GENESIS_SLOT} from "../constants/constants.js";
import {BuilderStatus} from "../execution/builder/http.js";
import {PayloadAttributes} from "../execution/index.js";
import {Metrics} from "../metrics/index.js";
import {ClockEvent} from "../util/clock.js";
import {isQueueErrorAborted} from "../util/queue/index.js";
import {ChainEvent} from "./emitter.js";
import {ForkchoiceCaller} from "./forkChoice/index.js";
import {IBeaconChain} from "./interface.js";
import {
  getPayloadAttributesForSSE,
  getPooledProposerPreferences,
  prepareExecutionPayload,
} from "./produceBlock/produceBlockBody.js";
import {RegenCaller} from "./regen/index.js";

/**
 * With 12s slot times, this scheduler will run 4s before the start of each slot (`12 - 0.6667 * 12 = 4`).
 *
 * Post-Gloas this is after the payload deadline (50% of the slot), so the parent's payload has normally been
 * imported, and before the PTC deadline (75%). The parent choice is revisited when the PTC verdict or a timely
 * payload comes in after the scheduled run, see `reprepare`.
 */
export const PREPARE_NEXT_SLOT_BPS = 6667;

/* We don't want to do more epoch transition than this */
const PREPARE_EPOCH_LIMIT = 1;

/* Fraction of a slot (out of 10_000) the pre-Gloas builder-deposit pre-verify may spend per tick.
 * 2000 = 20% of slot (2.4s on mainnet), within the spare window left after PREPARE_NEXT_SLOT_BPS.
 * Expressed in bps so it scales with slot duration (mainnet vs minimal/devnet). */
const BUILDER_PREVERIFY_LIMIT_BPS = 2000;

/**
 * How far before the next slot builder connections are pre-established, see `checkBuilderStatusBeforeSlot`.
 *
 * 1667 = 16.67% of slot (2s on mainnet). Must stay under the few seconds an idle connection survives,
 * while leaving room for a round trip to a distant builder to complete before the slot begins.
 */
const BUILDER_STATUS_CHECK_BEFORE_SLOT_BPS = 1667;

export enum PreparePayloadReason {
  /** The scheduled run at PREPARE_NEXT_SLOT_BPS of the slot */
  scheduled = "scheduled",
  /** The PTC reached a verdict on the payload of the current slot's block */
  ptcQuorum = "ptc_quorum",
  /** A timely payload of the current slot's block was imported after the scheduled run */
  payloadImported = "payload_imported",
}

/** Inputs the payload for `prepareSlot` was last prepared with, a re-prepare with the same inputs is skipped */
type PreparedPayload = {
  prepareSlot: Slot;
  proposerIndex: ValidatorIndex;
  headRoot: RootHex;
  /** Whether the payload builds on the parent's full payload or its empty variant, `null` pre-Gloas */
  buildOnFull: boolean | null;
  feeRecipient: string;
};

/**
 * At Bellatrix, if we are responsible for proposing in next slot, we want to prepare payload
 * 4s before the start of next slot at PREPARE_NEXT_SLOT_BPS of the current slot.
 *
 * For all forks, when clock reaches PREPARE_NEXT_SLOT_BPS of slot before an epoch, we want to prepare for the next epoch
 * transition from our head so that:
 * + validators vote for block head on time through attestation
 * + validators propose blocks on time
 * + For Bellatrix, to compute proposers of next epoch so that we can prepare new payloads
 *
 */
export class PrepareNextSlotScheduler {
  private lastPrepared: PreparedPayload | null = null;
  /** Slot a payload preparation is in flight for, a re-prepare requested meanwhile runs after it */
  private preparingSlot: Slot | null = null;
  private queuedReason: PreparePayloadReason | null = null;

  constructor(
    private readonly chain: IBeaconChain,
    private readonly config: ChainForkConfig,
    private readonly metrics: Metrics | null,
    private readonly logger: Logger,
    private readonly signal: AbortSignal
  ) {
    this.chain.clock.on(ClockEvent.slot, this.prepareForNextSlot);
    this.chain.emitter.on(ChainEvent.forkChoicePtcQuorum, this.onPtcQuorum);
    this.chain.emitter.on(routes.events.EventType.executionPayload, this.onExecutionPayloadImported);
    this.signal.addEventListener(
      "abort",
      () => {
        this.chain.clock.off(ClockEvent.slot, this.prepareForNextSlot);
        this.chain.emitter.off(ChainEvent.forkChoicePtcQuorum, this.onPtcQuorum);
        this.chain.emitter.off(routes.events.EventType.executionPayload, this.onExecutionPayloadImported);
      },
      {once: true}
    );
  }

  /**
   * Use clockSlot instead of clockEpoch to schedule the task at more exact time.
   */
  prepareForNextSlot = async (clockSlot: Slot): Promise<void> => {
    const prepareSlot = clockSlot + 1;
    const prepareEpoch = computeEpochAtSlot(prepareSlot);
    const nextEpoch = computeEpochAtSlot(clockSlot) + 1;
    const isEpochTransition = prepareEpoch === nextEpoch;
    const fork = this.config.getForkName(prepareSlot);
    const currentFork = this.config.getForkName(clockSlot);

    // Early return if we are pre-genesis
    //  or we are pre-bellatrix and this is not an epoch transition
    if (prepareSlot <= GENESIS_SLOT || (ForkSeq[fork] < ForkSeq.bellatrix && !isEpochTransition)) {
      return;
    }

    try {
      // At PREPARE_NEXT_SLOT_BPS (~67%) of the current slot we prepare payload for the next slot
      // or precompute epoch transition
      await sleep(this.config.getSlotComponentDurationMs(currentFork, PREPARE_NEXT_SLOT_BPS), this.signal);

      // Re-prepare requests from here on are queued until this run is done. Earlier ones are
      // dropped, the head computed below already reflects them.
      this.preparingSlot = prepareSlot;

      // calling updateHead() here before we produce a block to reduce reorg possibility
      const headBlock = this.chain.recomputeForkChoiceHead(ForkchoiceCaller.prepareNextSlot);
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

        return;
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
      // No need to wait for this or the clock drift
      if (isForkPostBellatrix(fork)) {
        let preparedState: IBeaconStateView | undefined;

        const getProposerIndex = async (): Promise<ValidatorIndex> => {
          if (isForkPostFulu(fork)) {
            // getBeaconProposer covers the current + next epoch; should not throw
            // PROPOSER_EPOCH_MISMATCH here due to the PREPARE_EPOCH_LIMIT check above.
            return this.chain.getHeadState().getBeaconProposer(prepareSlot);
          }
          // the slot 0 of next epoch will likely use this Previous Root Checkpoint state for state transition so we transfer cache here
          // the resulting state with cache will be cached in Checkpoint State Cache which is used for the upcoming block processing
          // for other slots dontTransferCached=true because we don't run state transition on this state
          preparedState = await this.chain.regen.getBlockSlotState(
            headBlock,
            prepareSlot,
            {dontTransferCache: !isEpochTransition},
            RegenCaller.precomputeEpoch
          );
          return preparedState.getBeaconProposer(prepareSlot);
        };

        const proposerIndex = await getProposerIndex();
        feeRecipient = this.getFeeRecipient(fork, prepareSlot, headRoot, proposerIndex);

        // Predict the proposer head of the next slot when either:
        //  - we are proposing the next slot (single-slot proposer-boost-reorg), or
        //  - this is an epoch transition: post-Fulu the next proposer may reorg a weak
        //    last-block-of-epoch and build slot 0 on the strong parent (epoch-boundary reorg),
        //    so we should dial the strong parent through the boundary instead of the weak head.
        if (feeRecipient || isEpochTransition) {
          const proposerHead = this.chain.predictProposerHead();
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
            this.chain.builderCircuitBreaker.update(clockSlot, updatedHead);
            this.checkBuilderStatusBeforeSlot(prepareSlot);
          } else {
            // Update the builder status, if enabled shoot an api call to check status
            this.chain.updateBuilderStatus(clockSlot);
            if (this.chain.executionBuilder?.status === BuilderStatus.enabled) {
              this.chain.executionBuilder.checkStatus().catch((e) => {
                this.logger.error("Builder disabled as the check status api failed", {prepareSlot}, e as Error);
              });
            }
          }
        }

        // post-fulu we'll always reach here because preparedState is undefined
        // we may run epoch transition not with headBlock if it's weak
        if (preparedState === undefined || updatedHead !== headBlock) {
          preparedState = await this.chain.regen.getBlockSlotState(
            updatedHead,
            prepareSlot,
            // only transfer cache if epoch transition because that's the state we will use to stateTransition() the 1st block of epoch
            {dontTransferCache: !isEpochTransition},
            updatedHead === headBlock ? RegenCaller.precomputeEpoch : RegenCaller.predictProposerHead
          );
        }

        await this.preparePayload({
          reason: PreparePayloadReason.scheduled,
          fork: fork as ForkPostBellatrix,
          prepareSlot,
          proposerIndex,
          feeRecipient,
          head: updatedHead,
          state: preparedState,
        });

        this.computeStateHashTreeRoot(preparedState, isEpochTransition);
      } else {
        // Pre-bellatrix only reaches here at an epoch transition to precompute the next epoch state
        const preparedState = await this.chain.regen.getBlockSlotState(
          headBlock,
          prepareSlot,
          {dontTransferCache: !isEpochTransition},
          RegenCaller.precomputeEpoch
        );
        this.computeStateHashTreeRoot(preparedState, isEpochTransition);
      }

      // assuming there is no reorg, it caches the checkpoint state & helps avoid doing a full state transition in the next slot
      //  + when gossip block comes, we need to validate and run state transition
      //  + if next slot is a skipped slot, it'd help getting target checkpoint state faster to validate attestations
      if (isEpochTransition) {
        this.metrics?.precomputeNextEpochTransition.count.inc({result: "success"}, 1);
        const previousHits = this.chain.regen.updatePreComputedCheckpoint(updatedHead.blockRoot, nextEpoch);
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
        return;
      }

      // Pre-verify builder-deposit signatures in the GLOAS_PREVERIFY_WINDOW_EPOCHS epochs leading
      // up to the Gloas fork, off the block-import hot path, so onboardBuildersFromPendingDeposits
      // at the transition is mostly cache hits. Reached only on non-epoch-transition slots (the
      // epoch-transition branch returned above). Runs on the head state — its pendingDeposits are
      // what the fork transition derives from, and its epochCtx holds the shared, app-wide
      // builderDepositSignatureCache.
      const headState = this.chain.getHeadState();
      if (isStatePostFulu(headState)) {
        const gloasEpoch = this.config.GLOAS_FORK_EPOCH;
        const finalizedEpoch = this.chain.forkChoice.getFinalizedCheckpoint().epoch;
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
            const maxDurationMs = this.config.getSlotComponentDurationMs(currentFork, BUILDER_PREVERIFY_LIMIT_BPS);
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
    } catch (e) {
      if (!isErrorAborted(e) && !isQueueErrorAborted(e)) {
        this.metrics?.precomputeNextEpochTransition.count.inc({result: "error"}, 1);
        this.logger.error("Failed to run prepareForNextSlot", {nextEpoch, isEpochTransition, prepareSlot}, e as Error);
      }
    } finally {
      this.finishRun(prepareSlot);
    }
  };

  /**
   * Choose the parent the payload for `prepareSlot` builds on, emit the payload attributes and ask the engine
   * to build the payload. Records the inputs so a later `reprepare` can skip an unchanged result.
   */
  private async preparePayload({
    reason,
    fork,
    prepareSlot,
    proposerIndex,
    feeRecipient,
    head,
    state,
  }: {
    reason: PreparePayloadReason;
    fork: ForkPostBellatrix;
    prepareSlot: Slot;
    proposerIndex: ValidatorIndex;
    feeRecipient: string | undefined;
    head: ProtoBlock;
    state: IBeaconStateView;
  }): Promise<void> {
    if (!isStatePostBellatrix(state)) {
      throw new Error("Expected Bellatrix state for payload attributes");
    }

    let parentBlockHash: Bytes32;
    let buildOnFull: boolean | null = null;
    // Apply parent payload once here as it's reused by EL prep and SSE emit below
    let stateAfterParentPayload: IBeaconStateViewBellatrix = state;
    if (isStatePostGloas(state)) {
      // Spec: should_build_on_full(store, head, slot) - see produceBlockBody.ts for context.
      buildOnFull = this.chain.forkChoice.shouldBuildOnFull(head, prepareSlot);
      if (buildOnFull) {
        parentBlockHash = state.latestExecutionPayloadBid.blockHash;
        // Skip applying parent payload unless we're proposing the next slot or have to emit payload_attributes events
        if (feeRecipient !== undefined || this.chain.opts.emitPayloadAttributes === true) {
          const parentExecutionRequests = await this.chain.getParentExecutionRequests(head.slot, head.blockRoot);
          stateAfterParentPayload = state.withParentPayloadApplied(parentExecutionRequests);
        }
      } else {
        parentBlockHash = state.latestExecutionPayloadBid.parentBlockHash;
      }
    } else {
      parentBlockHash = state.latestExecutionPayloadHeader.blockHash;
    }

    // The payload_attributes event must carry the same hashes we send to the EL
    const safeBlockHash = getSafeExecutionBlockHash(this.chain.forkChoice, this.logger);
    const finalizedBlockHash = getFinalizedExecutionBlockHash(this.chain.forkChoice);

    let payloadAttributes: PayloadAttributes | undefined;
    // If emitPayloadAttributes is true emit a SSE payloadAttributes event for
    // every slot. Without the flag, only emit the event if we are proposing in the next slot.
    if (
      (feeRecipient || this.chain.opts.emitPayloadAttributes === true) &&
      this.chain.emitter.listenerCount(routes.events.EventType.payloadAttributes)
    ) {
      const data = getPayloadAttributesForSSE(fork, this.chain, {
        prepareState: stateAfterParentPayload,
        prepareSlot,
        parentBlockRoot: fromHex(head.blockRoot),
        parentBlockHash,
        safeBlockHash,
        finalizedBlockHash,
        feeRecipient: feeRecipient ?? "0x0000000000000000000000000000000000000000",
      });
      this.chain.emitter.emit(routes.events.EventType.payloadAttributes, {data, version: fork});
      payloadAttributes = data.payloadAttributes;
    }

    if (feeRecipient) {
      const preparationTime = computeTimeAtSlot(this.config, prepareSlot, this.chain.genesisTime) - Date.now() / 1000;
      this.metrics?.blockPayload.payloadAdvancePrepTime.observe(preparationTime);

      // awaiting here instead of throwing an async call because there is no other task
      // left for scheduler and this gives nice semantics to catch and log errors in the
      // try/catch wrapper here.
      await prepareExecutionPayload(
        this.chain,
        this.logger,
        fork, // State is of execution type
        fromHex(head.blockRoot),
        parentBlockHash,
        safeBlockHash,
        finalizedBlockHash,
        stateAfterParentPayload,
        feeRecipient,
        payloadAttributes
      );
      this.lastPrepared = {prepareSlot, proposerIndex, headRoot: head.blockRoot, buildOnFull, feeRecipient};
      if (reason !== PreparePayloadReason.scheduled) {
        this.metrics?.blockPayload.payloadReprepare.inc({reason, result: "changed"});
      }
      this.logger.verbose("PrepareNextSlotScheduler prepared new payload", {
        prepareSlot,
        proposerIndex,
        feeRecipient,
        reason,
        headRoot: head.blockRoot,
        buildOnFull,
      });
    }
  }

  /** Fee recipient of our validator proposing `prepareSlot`, `undefined` if the proposer is not ours */
  private getFeeRecipient(
    fork: ForkName,
    prepareSlot: Slot,
    headRoot: RootHex,
    proposerIndex: ValidatorIndex
  ): string | undefined {
    if (!this.chain.beaconProposerCache.has(proposerIndex)) {
      return undefined;
    }
    const pooledPreferences = isForkPostGloas(fork)
      ? getPooledProposerPreferences(this.chain, prepareSlot, headRoot)
      : null;
    return pooledPreferences !== null
      ? toHex(pooledPreferences.feeRecipient)
      : this.chain.beaconProposerCache.getOrDefault(proposerIndex);
  }

  /**
   * The PTC verdict on the current slot's block decides whether the next proposal extends its payload.
   * Spec: the proposer SHOULD call `prepare_execution_payload` again once the parent's payload attestations are in.
   */
  private onPtcQuorum = (data: PtcQuorumEvent): void => {
    if (data.slot === this.chain.clock.currentSlot) {
      this.requestReprepare(PreparePayloadReason.ptcQuorum);
    }
  };

  /**
   * A payload of the current slot's block imported after the scheduled run moves the head to its full variant.
   * Only react to a payload the PTC will vote present, seen before the payload deadline with all its data. A late
   * one will be voted absent and the re-prepare undone by the verdict.
   */
  private onExecutionPayloadImported = ({slot, blockRoot}: {slot: Slot; blockRoot: RootHex}): void => {
    if (slot !== this.chain.clock.currentSlot) {
      return;
    }
    const payloadInput = this.chain.seenPayloadEnvelopeInputCache.get(blockRoot);
    if (payloadInput === undefined || !payloadInput.hasPayloadEnvelope() || !payloadInput.hasAllData()) {
      return;
    }
    const seenSec = this.chain.clock.secFromSlot(slot, payloadInput.getPayloadEnvelopeSource().seenTimestampSec);
    if (seenSec >= this.config.getPayloadDueMs(this.config.getForkName(slot)) / 1000) {
      return;
    }
    this.requestReprepare(PreparePayloadReason.payloadImported);
  };

  /**
   * Re-run the payload preparation for the next slot after its inputs may have changed. Waits for an in-flight
   * preparation, drops the request if no payload was prepared for the next slot (not our proposal).
   */
  private requestReprepare(reason: PreparePayloadReason): void {
    const prepareSlot = this.chain.clock.currentSlot + 1;
    if (this.preparingSlot !== null) {
      if (this.preparingSlot === prepareSlot) {
        this.queuedReason = reason;
      }
      return;
    }
    if (this.lastPrepared?.prepareSlot !== prepareSlot) {
      return;
    }

    this.preparingSlot = prepareSlot;
    this.reprepare(prepareSlot, reason)
      .catch((e) => {
        if (!isErrorAborted(e) && !isQueueErrorAborted(e)) {
          this.logger.error("Failed to re-prepare payload for next slot", {prepareSlot, reason}, e as Error);
        }
      })
      .finally(() => this.finishRun(prepareSlot));
  }

  private finishRun(prepareSlot: Slot): void {
    if (this.preparingSlot !== prepareSlot) {
      return;
    }
    this.preparingSlot = null;
    const queued = this.queuedReason;
    this.queuedReason = null;
    if (queued !== null) {
      this.requestReprepare(queued);
    }
  }

  private async reprepare(prepareSlot: Slot, reason: PreparePayloadReason): Promise<void> {
    const prepared = this.lastPrepared;
    const fork = this.config.getForkName(prepareSlot);
    if (prepared === null || prepared.prepareSlot !== prepareSlot || !isForkPostBellatrix(fork)) {
      return;
    }

    // Same head resolution as the scheduled run, the head may have changed since
    const headBlock = this.chain.recomputeForkChoiceHead(ForkchoiceCaller.prepareNextSlot);
    const proposerHead = this.chain.predictProposerHead();
    const head = proposerHead.blockRoot !== headBlock.blockRoot ? proposerHead : headBlock;
    const feeRecipient = this.getFeeRecipient(fork, prepareSlot, head.blockRoot, prepared.proposerIndex);
    if (feeRecipient === undefined) {
      return;
    }

    const buildOnFull = isForkPostGloas(fork) ? this.chain.forkChoice.shouldBuildOnFull(head, prepareSlot) : null;
    const logCtx = {prepareSlot, reason, headRoot: head.blockRoot, buildOnFull};
    if (
      head.blockRoot === prepared.headRoot &&
      buildOnFull === prepared.buildOnFull &&
      feeRecipient === prepared.feeRecipient
    ) {
      this.metrics?.blockPayload.payloadReprepare.inc({reason, result: "unchanged"});
      this.logger.debug("Payload for next slot unchanged, not re-preparing", logCtx);
      return;
    }
    this.logger.verbose("Re-preparing payload for next slot", {
      ...logCtx,
      prevHeadRoot: prepared.headRoot,
      prevBuildOnFull: prepared.buildOnFull,
    });

    const isEpochTransition = computeEpochAtSlot(prepareSlot) > computeEpochAtSlot(prepareSlot - 1);
    const state = await this.chain.regen.getBlockSlotState(
      head,
      prepareSlot,
      {dontTransferCache: !isEpochTransition},
      head === headBlock ? RegenCaller.precomputeEpoch : RegenCaller.predictProposerHead
    );

    await this.preparePayload({
      reason,
      fork,
      prepareSlot,
      proposerIndex: prepared.proposerIndex,
      feeRecipient,
      head,
      state,
    });
  }

  /**
   * Pre-establish the builder connections so the handshake lands outside the bid deadline. Scheduled
   * later in the slot, connecting at PREPARE_NEXT_SLOT_BPS would go cold before bids are requested.
   */
  private checkBuilderStatusBeforeSlot(prepareSlot: Slot): void {
    const msBeforeSlot = this.config.getSlotComponentDurationMs(
      this.config.getForkName(prepareSlot - 1),
      BUILDER_STATUS_CHECK_BEFORE_SLOT_BPS
    );
    const msUntilCheck = -this.chain.clock.msFromSlot(prepareSlot) - msBeforeSlot;
    sleep(Math.max(0, msUntilCheck), this.signal)
      .then(() => this.chain.builderApiClient.checkStatus())
      .catch((e) => {
        if (!isErrorAborted(e)) {
          this.logger.debug("Failed to check builder status", {prepareSlot}, e as Error);
        }
      });
  }

  computeStateHashTreeRoot(state: IBeaconStateView, isEpochTransition: boolean): void {
    // cache HashObjects for faster hashTreeRoot() later, especially for computeNewStateRoot() if we need to produce a block at slot 0 of epoch
    // see https://github.com/ChainSafe/lodestar/issues/6194
    const hashTreeRootTimer = this.metrics?.stateHashTreeRootTime.startTimer({
      source: isEpochTransition ? StateHashTreeRootSource.prepareNextEpoch : StateHashTreeRootSource.prepareNextSlot,
    });
    state.hashTreeRoot();
    hashTreeRootTimer?.();
  }
}
