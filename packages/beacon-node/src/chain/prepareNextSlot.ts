import {
  computeEpochAtSlot,
  isExecutionStateType,
  computeTimeAtSlot,
  CachedBeaconStateExecutions,
  StateHashTreeRootSource,
  CachedBeaconStateAllForks,
} from "@lodestar/state-transition";
import {ChainForkConfig} from "@lodestar/config";
import {ForkSeq, SLOTS_PER_EPOCH, ForkExecution} from "@lodestar/params";
import {Slot} from "@lodestar/types";
import {Logger, sleep, fromHex, isErrorAborted} from "@lodestar/utils";
import {routes} from "@lodestar/api";
import {GENESIS_SLOT, ZERO_HASH_HEX} from "../constants/constants.js";
import {Metrics} from "../metrics/index.js";
import {ClockEvent} from "../util/clock.js";
import {isQueueErrorAborted} from "../util/queue/index.js";
import {prepareExecutionPayload, getPayloadAttributesForSSE} from "./produceBlock/produceBlockBody.js";
import {IBeaconChain} from "./interface.js";
import {RegenCaller} from "./regen/index.js";
import {ForkchoiceCaller} from "./forkChoice/index.js";

/* With 12s slot times, this scheduler will run 4s before the start of each slot (`12 / 3 = 4`). */
export const SCHEDULER_LOOKAHEAD_FACTOR = 3;

/* We don't want to do more epoch transition than this */
const PREPARE_EPOCH_LIMIT = 1;

/**
 * At Bellatrix, if we are responsible for proposing in next slot, we want to prepare payload
 * 4s (1/3 slot) before the start of next slot
 *
 * For all forks, when clock is 1/3 slot before an epoch, we want to prepare for the next epoch
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
      // At 1/3 slot time before the next slot, we either prepare payload or precompute
      // epoch transition
      const slotMs = this.config.SECONDS_PER_SLOT * 1000;
      await sleep(slotMs - slotMs / SCHEDULER_LOOKAHEAD_FACTOR, this.signal);

      // calling updateHead() here before we produce a block to reduce reorg possibility
      const {slot: headSlot, blockRoot: headRoot} = this.chain.recomputeForkChoiceHead(
        ForkchoiceCaller.prepareNextSlot
      );

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
      // No need to wait for this or the clock drift
      // Pre Bellatrix: we only do precompute state transition for the last slot of epoch
      // For Bellatrix, we always do the `processSlots()` to prepare payload for the next slot
      const prepareState = await this.chain.regen.getBlockSlotState(
        headRoot,
        prepareSlot,
        // the slot 0 of next epoch will likely use this Previous Root Checkpoint state for state transition so we transfer cache here
        // the resulting state with cache will be cached in Checkpoint State Cache which is used for the upcoming block processing
        // for other slots dontTransferCached=true because we don't run state transition on this state
        {dontTransferCache: !isEpochTransition},
        RegenCaller.precomputeEpoch
      );

      if (isExecutionStateType(prepareState)) {
        const proposerIndex = prepareState.epochCtx.getBeaconProposer(prepareSlot);
        const feeRecipient = this.chain.beaconProposerCache.get(proposerIndex);
        let updatedPrepareState = prepareState;
        let updatedHeadRoot = headRoot;

        if (feeRecipient) {
          // If we are proposing next slot, we need to predict if we can proposer-boost-reorg or not
          const {slot: proposerHeadSlot, blockRoot: proposerHeadRoot} = this.chain.predictProposerHead(clockSlot);

          // If we predict we can reorg, update prepareState with proposer head block
          if (proposerHeadRoot !== headRoot || proposerHeadSlot !== headSlot) {
            this.logger.verbose("Weak head detected. May build on this block instead:", {
              proposerHeadSlot,
              proposerHeadRoot,
              headSlot,
              headRoot,
            });
            this.metrics?.weakHeadDetected.inc();
            updatedPrepareState = (await this.chain.regen.getBlockSlotState(
              proposerHeadRoot,
              prepareSlot,
              {dontTransferCache: !isEpochTransition},
              RegenCaller.predictProposerHead
            )) as CachedBeaconStateExecutions;
            updatedHeadRoot = proposerHeadRoot;
          }

          // Update the builder status, if enabled shoot an api call to check status
          this.chain.updateBuilderStatus(clockSlot);
          if (this.chain.executionBuilder?.status) {
            this.chain.executionBuilder.checkStatus().catch((e) => {
              this.logger.error("Builder disabled as the check status api failed", {prepareSlot}, e as Error);
            });
          }

          const preparationTime =
            computeTimeAtSlot(this.config, prepareSlot, this.chain.genesisTime) - Date.now() / 1000;
          this.metrics?.blockPayload.payloadAdvancePrepTime.observe(preparationTime);

          const safeBlockHash = this.chain.forkChoice.getJustifiedBlock().executionPayloadBlockHash ?? ZERO_HASH_HEX;
          const finalizedBlockHash =
            this.chain.forkChoice.getFinalizedBlock().executionPayloadBlockHash ?? ZERO_HASH_HEX;
          // awaiting here instead of throwing an async call because there is no other task
          // left for scheduler and this gives nice sematics to catch and log errors in the
          // try/catch wrapper here.
          await prepareExecutionPayload(
            this.chain,
            this.logger,
            fork as ForkExecution, // State is of execution type
            fromHex(updatedHeadRoot),
            safeBlockHash,
            finalizedBlockHash,
            updatedPrepareState,
            feeRecipient
          );
          this.logger.verbose("PrepareNextSlotScheduler prepared new payload", {
            prepareSlot,
            proposerIndex,
            feeRecipient,
          });
        }

        this.computeStateHashTreeRoot(updatedPrepareState, isEpochTransition);

        // If emitPayloadAttributes is true emit a SSE payloadAttributes event
        if (this.chain.opts.emitPayloadAttributes === true) {
          const data = await getPayloadAttributesForSSE(fork as ForkExecution, this.chain, {
            prepareState: updatedPrepareState,
            prepareSlot,
            parentBlockRoot: fromHex(headRoot),
            // The likely consumers of this API are builders and will anyway ignore the
            // feeRecipient, so just pass zero hash for now till a real use case arises
            feeRecipient: "0x0000000000000000000000000000000000000000000000000000000000000000",
          });
          this.chain.emitter.emit(routes.events.EventType.payloadAttributes, {data, version: fork});
        }
      } else {
        this.computeStateHashTreeRoot(prepareState, isEpochTransition);
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
        });

        precomputeEpochTransitionTimer?.();
      }
    } catch (e) {
      if (!isErrorAborted(e) && !isQueueErrorAborted(e)) {
        this.metrics?.precomputeNextEpochTransition.count.inc({result: "error"}, 1);
        this.logger.error("Failed to run prepareForNextSlot", {nextEpoch, isEpochTransition, prepareSlot}, e as Error);
      }
    }
  };

  computeStateHashTreeRoot(state: CachedBeaconStateAllForks, isEpochTransition: boolean): void {
    // cache HashObjects for faster hashTreeRoot() later, especially for computeNewStateRoot() if we need to produce a block at slot 0 of epoch
    // see https://github.com/ChainSafe/lodestar/issues/6194
    const hashTreeRootTimer = this.metrics?.stateHashTreeRootTime.startTimer({
      source: isEpochTransition ? StateHashTreeRootSource.prepareNextEpoch : StateHashTreeRootSource.prepareNextSlot,
    });
    state.hashTreeRoot();
    hashTreeRootTimer?.();
  }
}
