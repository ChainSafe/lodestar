import {computeEpochAtSlot, isBellatrixStateType} from "@lodestar/state-transition";
import {IChainForkConfig} from "@lodestar/config";
import {ForkSeq, SLOTS_PER_EPOCH} from "@lodestar/params";
import {Slot} from "@lodestar/types";
import {ILogger, sleep} from "@lodestar/utils";
import {GENESIS_EPOCH, ZERO_HASH_HEX} from "../constants/constants.js";
import {IMetrics} from "../metrics/index.js";
import {ChainEvent} from "./emitter.js";
import {prepareExecutionPayload} from "./factory/block/body.js";
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
  constructor(
    private readonly chain: IBeaconChain,
    private readonly config: IChainForkConfig,
    private readonly metrics: IMetrics | null,
    private readonly logger: ILogger,
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
    const isLastEpochSlot = (clockSlot + 1) % SLOTS_PER_EPOCH === 0;
    if (this.config.getForkSeq(prepareEpoch) < ForkSeq.bellatrix && !isLastEpochSlot) {
      return;
    }

    const slotMs = this.config.SECONDS_PER_SLOT * 1000;
    // At 1/3 slot time before the next slot, we either prepare payload or precompute epoch transition
    await sleep(slotMs - slotMs / SCHEDULER_LOOKAHEAD_FACTOR, this.signal);

    // calling updateHead() here before we produce a block to reduce reorg possibility
    const {slot: headSlot, blockRoot: headRoot} = this.chain.forkChoice.updateHead();
    const nextEpoch = computeEpochAtSlot(clockSlot) + 1;
    // Do nothing at pre genesis
    if (nextEpoch <= GENESIS_EPOCH) return;

    const headEpoch = computeEpochAtSlot(headSlot);
    if (prepareEpoch - headEpoch > PREPARE_EPOCH_LIMIT) {
      this.metrics?.precomputeNextEpochTransition.count.inc({result: "skip"}, 1);
      this.logger.debug("Skipping PrepareNextSlotScheduler - head slot is too behind current slot", {
        nextEpoch,
        headSlot,
        clockSlot,
      });

      return;
    }

    if (prepareEpoch > headEpoch) {
      this.logger.verbose("Running PrepareNextSlotScheduler epoch transition", {nextEpoch, headSlot, prepareSlot});
    }

    // No need to wait for this or the clock drift
    // Pre Bellatrix: we only do precompute state transition for the last slot of epoch
    // For Bellatrix, we always do the `processSlots()` to prepare payload for the next slot
    this.chain.regen
      .getBlockSlotState(headRoot, prepareSlot, RegenCaller.precomputeEpoch)
      .then((prepareState) => {
        // assuming there is no reorg, it caches the checkpoint state & helps avoid doing a full state transition in the next slot
        //  + when gossip block comes, we need to validate and run state transition
        //  + if next slot is a skipped slot, it'd help getting target checkpoint state faster to validate attestations
        if (prepareEpoch > headEpoch) {
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

        if (isBellatrixStateType(prepareState)) {
          const proposerIndex = prepareState.epochCtx.getBeaconProposer(prepareSlot);
          const feeRecipient = this.chain.beaconProposerCache.get(proposerIndex);
          if (feeRecipient) {
            const safeBlockHash = this.chain.forkChoice.getJustifiedBlock().executionPayloadBlockHash ?? ZERO_HASH_HEX;
            const finalizedBlockHash =
              this.chain.forkChoice.getFinalizedBlock().executionPayloadBlockHash ?? ZERO_HASH_HEX;
            void prepareExecutionPayload(this.chain, safeBlockHash, finalizedBlockHash, prepareState, feeRecipient);
            this.logger.verbose("PrepareNextSlotScheduler prepared new payload", {
              prepareSlot,
              proposerIndex,
              feeRecipient,
            });
          }
        }
      })
      .catch((e) => {
        this.metrics?.precomputeNextEpochTransition.count.inc({result: "error"}, 1);
        this.logger.error("Failed to precompute epoch transition", nextEpoch, e);
      });
  };
}
