import {routes} from "@lodestar/api";
import {ChainForkConfig} from "@lodestar/config";
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
import {Logger, fromHex, isErrorAborted, sleep} from "@lodestar/utils";
import {GENESIS_SLOT} from "../constants/constants.js";
import {BuilderStatus} from "../execution/builder/http.js";
import {Metrics} from "../metrics/index.js";
import {ClockEvent} from "../util/clock.js";
import {isQueueErrorAborted} from "../util/queue/index.js";
import {ForkchoiceCaller} from "./forkChoice/index.js";
import {IBeaconChain} from "./interface.js";
import {getPayloadAttributesForSSE, prepareExecutionPayload} from "./produceBlock/produceBlockBody.js";
import {RegenCaller} from "./regen/index.js";

// TODO GLOAS: re-evaluate this timing
/* With 12s slot times, this scheduler will run 4s before the start of each slot (`12 - 0.6667 * 12 = 4`). */
export const PREPARE_NEXT_SLOT_BPS = 6667;

/* We don't want to do more epoch transition than this */
const PREPARE_EPOCH_LIMIT = 1;

/* Fraction of a slot (out of 10_000) the pre-Gloas builder-deposit pre-verify may spend per tick.
 * 2000 = 20% of slot (2.4s on mainnet), within the spare window left after PREPARE_NEXT_SLOT_BPS.
 * Expressed in bps so it scales with slot duration (mainnet vs minimal/devnet). */
const BUILDER_PREVERIFY_LIMIT_BPS = 2000;

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
  constructor(
    private readonly chain: IBeaconChain,
    private readonly config: ChainForkConfig,
    private readonly metrics: Metrics | null,
    private readonly logger: Logger,
    private readonly signal: AbortSignal
  ) {
    this.chain.clock.on(ClockEvent.slot, this.prepareForNextSlot);
    this.signal.addEventListener(
      "abort",
      () => {
        this.chain.clock.off(ClockEvent.slot, this.prepareForNextSlot);
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

    // Early return if we are pre-genesis
    //  or we are pre-bellatrix and this is not an epoch transition
    if (prepareSlot <= GENESIS_SLOT || (ForkSeq[fork] < ForkSeq.bellatrix && !isEpochTransition)) {
      return;
    }

    try {
      // At PREPARE_NEXT_SLOT_BPS (~67%) of the current slot we prepare payload for the next slot
      // or precompute epoch transition
      await sleep(this.config.getSlotComponentDurationMs(PREPARE_NEXT_SLOT_BPS), this.signal);

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
        feeRecipient = this.chain.beaconProposerCache.get(proposerIndex);

        if (feeRecipient) {
          // If we are proposing next slot, we need to predict if we can proposer-boost-reorg or not
          const proposerHead = this.chain.predictProposerHead(clockSlot);
          const {slot: proposerHeadSlot, blockRoot: proposerHeadRoot} = proposerHead;

          // If we predict we can reorg, we build on the proposer head (parent) block instead
          if (proposerHeadRoot !== headRoot || proposerHeadSlot !== headSlot) {
            this.logger.verbose("Weak head detected. May build on parent block instead", {
              proposerHeadSlot,
              proposerHeadRoot,
              headSlot,
              headRoot,
            });
            this.metrics?.weakHeadDetected.inc();
            updatedHead = proposerHead;
          }

          if (isForkPostGloas(fork)) {
            this.chain.builderCircuitBreaker.update(clockSlot, updatedHead);
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
        if (preparedState === undefined || updatedHead !== headBlock) {
          preparedState = await this.chain.regen.getBlockSlotState(
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
          if (this.chain.forkChoice.shouldBuildOnFull(updatedHead, prepareSlot)) {
            parentBlockHash = preparedState.latestExecutionPayloadBid.blockHash;
            // Skip applying parent payload unless we're proposing the next slot or have to emit payload_attributes events
            if (feeRecipient !== undefined || this.chain.opts.emitPayloadAttributes === true) {
              const parentExecutionRequests = await this.chain.getParentExecutionRequests(
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

        if (feeRecipient) {
          const preparationTime =
            computeTimeAtSlot(this.config, prepareSlot, this.chain.genesisTime) - Date.now() / 1000;
          this.metrics?.blockPayload.payloadAdvancePrepTime.observe(preparationTime);

          const safeBlockHash = getSafeExecutionBlockHash(this.chain.forkChoice, this.logger);
          const finalizedBlockHash = getFinalizedExecutionBlockHash(this.chain.forkChoice);

          // awaiting here instead of throwing an async call because there is no other task
          // left for scheduler and this gives nice semantics to catch and log errors in the
          // try/catch wrapper here.
          await prepareExecutionPayload(
            this.chain,
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

        this.computeStateHashTreeRoot(preparedState, isEpochTransition);

        // If emitPayloadAttributes is true emit a SSE payloadAttributes event for
        // every slot. Without the flag, only emit the event if we are proposing in the next slot.
        if (
          (feeRecipient || this.chain.opts.emitPayloadAttributes === true) &&
          this.chain.emitter.listenerCount(routes.events.EventType.payloadAttributes)
        ) {
          const data = getPayloadAttributesForSSE(fork as ForkPostBellatrix, this.chain, {
            prepareState: stateAfterParentPayload,
            prepareSlot,
            parentBlockRoot: fromHex(updatedHead.blockRoot),
            parentBlockHash,
            feeRecipient: feeRecipient ?? "0x0000000000000000000000000000000000000000",
          });
          this.chain.emitter.emit(routes.events.EventType.payloadAttributes, {
            data,
            version: fork,
            ...(isForkPostGloas(fork)
              ? {
                  safeBlockHash: getSafeExecutionBlockHash(this.chain.forkChoice, this.logger),
                  finalizedBlockHash: getFinalizedExecutionBlockHash(this.chain.forkChoice),
                }
              : {}),
          });
        }
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
        const previousHits = this.chain.regen.updatePreComputedCheckpoint(headRoot, nextEpoch);
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
    } catch (e) {
      if (!isErrorAborted(e) && !isQueueErrorAborted(e)) {
        this.metrics?.precomputeNextEpochTransition.count.inc({result: "error"}, 1);
        this.logger.error("Failed to run prepareForNextSlot", {nextEpoch, isEpochTransition, prepareSlot}, e as Error);
      }
    }
  };

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
