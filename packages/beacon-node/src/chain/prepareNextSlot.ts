import {computeEpochAtSlot, isExecutionStateType, computeTimeAtSlot} from "@lodestar/state-transition";
import {ChainForkConfig} from "@lodestar/config";
import {ForkSeq, SLOTS_PER_EPOCH, ForkExecution} from "@lodestar/params";
import {Slot} from "@lodestar/types";
import {Logger, sleep} from "@lodestar/utils";
import {GENESIS_SLOT, ZERO_HASH_HEX} from "../constants/constants.js";
import {Metrics} from "../metrics/index.js";
import {TransitionConfigurationV1} from "../execution/engine/interface.js";
import {ChainEvent} from "./emitter.js";
import {prepareExecutionPayload} from "./produceBlock/produceBlockBody.js";
import {IBeaconChain} from "./interface.js";
import {RegenCaller} from "./regen/index.js";

/* With 12s slot times, this scheduler will run 4s before the start of each slot (`12 / 3 = 4`). */
const SCHEDULER_LOOKAHEAD_FACTOR = 3;

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
  private transitionConfig: TransitionConfigurationV1 | null = null;
  constructor(
    private readonly chain: IBeaconChain,
    private readonly config: ChainForkConfig,
    private readonly metrics: Metrics | null,
    private readonly logger: Logger,
    private readonly signal: AbortSignal
  ) {
    this.chain.emitter.on(ChainEvent.clockSlot, this.prepareForNextSlot);
    this.signal.addEventListener(
      "abort",
      () => {
        this.chain.emitter.off(ChainEvent.clockSlot, this.prepareForNextSlot);
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
      const {slot: headSlot, blockRoot: headRoot} = this.chain.recomputeForkChoiceHead();

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
      // No need to wait for this or the clock drift
      // Pre Bellatrix: we only do precompute state transition for the last slot of epoch
      // For Bellatrix, we always do the `processSlots()` to prepare payload for the next slot
      const prepareState = await this.chain.regen.getBlockSlotState(
        headRoot,
        prepareSlot,
        {dontTransferCache: true},
        RegenCaller.precomputeEpoch
      );

      // assuming there is no reorg, it caches the checkpoint state & helps avoid doing a full state transition in the next slot
      //  + when gossip block comes, we need to validate and run state transition
      //  + if next slot is a skipped slot, it'd help getting target checkpoint state faster to validate attestations
      if (isEpochTransition) {
        this.metrics?.precomputeNextEpochTransition.count.inc({result: "success"}, 1);
        const previousHits = this.chain.checkpointStateCache.updatePreComputedCheckpoint(headRoot, nextEpoch);
        if (previousHits === 0) {
          this.metrics?.precomputeNextEpochTransition.waste.inc();
        }
        this.metrics?.precomputeNextEpochTransition.hits.set(previousHits ?? 0);
        this.logger.verbose("Completed PrepareNextSlotScheduler epoch transition", {
          nextEpoch,
          headSlot,
          prepareSlot,
        });
      }

      if (isExecutionStateType(prepareState)) {
        const proposerIndex = prepareState.epochCtx.getBeaconProposer(prepareSlot);
        const feeRecipient = this.chain.beaconProposerCache.get(proposerIndex);
        if (feeRecipient) {
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
            safeBlockHash,
            finalizedBlockHash,
            prepareState,
            feeRecipient
          );
          this.logger.verbose("PrepareNextSlotScheduler prepared new payload", {
            prepareSlot,
            proposerIndex,
            feeRecipient,
          });
        }
      }
    } catch (e) {
      this.metrics?.precomputeNextEpochTransition.count.inc({result: "error"}, 1);
      this.logger.error("Failed to run prepareForNextSlot", {nextEpoch, isEpochTransition, prepareSlot}, e as Error);
    }
  };
}
