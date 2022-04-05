import {AbortSignal} from "@chainsafe/abort-controller";
import {computeEpochAtSlot} from "@chainsafe/lodestar-beacon-state-transition";
import {IChainForkConfig} from "@chainsafe/lodestar-config";
import {SLOTS_PER_EPOCH} from "@chainsafe/lodestar-params";
import {Slot} from "@chainsafe/lodestar-types";
import {ILogger, sleep} from "@chainsafe/lodestar-utils";
import {IMetrics} from "../metrics";
import {ChainEvent} from "./emitter";
import {IBeaconChain} from "./interface";
import {RegenCaller} from "./regen";

/**
 * When node is synced and 1/3 slot before an epoch, we want to prepare for the next epoch
 * transition from our head so that:
 * + validators vote for block head on time through attestation
 * + validators propose blocks on time
 */
export class PrecomputeNextEpochTransitionScheduler {
  constructor(
    private readonly chain: IBeaconChain,
    private readonly config: IChainForkConfig,
    private readonly metrics: IMetrics | null,
    private readonly logger: ILogger,
    private readonly signal: AbortSignal
  ) {
    this.chain.emitter.on(ChainEvent.clockSlot, this.prepareForNextEpoch);

    this.signal.addEventListener(
      "abort",
      () => {
        this.chain.emitter.off(ChainEvent.clockSlot, this.prepareForNextEpoch);
      },
      {once: true}
    );
  }

  /**
   * Use clockSlot instead of clockEpoch to schedule the task at more exact time.
   */
  prepareForNextEpoch = async (clockSlot: Slot): Promise<void> => {
    // only interested in last slot of epoch
    if ((clockSlot + 1) % SLOTS_PER_EPOCH !== 0) {
      return;
    }

    // Precalculate epoch transition 2/3 of the way through the last slot of the epoch
    const msToPrecalculateTime = (this.config.SECONDS_PER_SLOT * 1000 * 2) / 3;
    await sleep(msToPrecalculateTime, this.signal);

    const {slot: headSlot, blockRoot} = this.chain.forkChoice.getHead();
    const nextEpoch = computeEpochAtSlot(clockSlot) + 1;
    // Don't want to pre compute epoch transition at pre genesis
    if (nextEpoch <= 0) return;
    // node may be syncing or out of synced
    if (headSlot < clockSlot) {
      this.metrics?.precomputeNextEpochTransition.count.inc({result: "skip"}, 1);
      this.logger.debug("Skipping PrecomputeEpochScheduler - head slot is not current slot", {
        nextEpoch,
        headSlot,
        slot: clockSlot,
      });
      return;
    }

    // we want to make sure headSlot === clockSlot to do early epoch transition
    const nextSlot = clockSlot + 1;
    this.logger.verbose("Running PrecomputeEpochScheduler", {nextEpoch, headSlot, nextSlot});

    // this takes 2s - 4s as of Oct 2021, no need to wait for this or the clock drift
    // assuming there is no reorg, it caches the checkpoint state & helps avoid doing a full state transition in the next slot
    //  + when gossip block comes, we need to validate and run state transition
    //  + if next slot is a skipped slot, it'd help getting target checkpoint state faster to validate attestations
    this.chain.regen
      .getBlockSlotState(blockRoot, nextSlot, RegenCaller.precomputeEpoch)
      .then(() => {
        this.metrics?.precomputeNextEpochTransition.count.inc({result: "success"}, 1);
        const previousHits = this.chain.checkpointStateCache.updatePreComputedCheckpoint(blockRoot, nextEpoch);
        if (previousHits === 0) {
          this.metrics?.precomputeNextEpochTransition.waste.inc();
        }
        this.metrics?.precomputeNextEpochTransition.hits.set(previousHits ?? 0);
        this.logger.verbose("Completed PrecomputeEpochScheduler", {nextEpoch, headSlot, nextSlot});
      })
      .catch((e) => {
        this.metrics?.precomputeNextEpochTransition.count.inc({result: "error"}, 1);
        this.logger.error("Failed to precompute epoch transition", nextEpoch, e);
      });
  };
}
