import {AbortSignal} from "@chainsafe/abort-controller";
import {computeEpochAtSlot} from "@chainsafe/lodestar-beacon-state-transition";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {SLOTS_PER_EPOCH} from "@chainsafe/lodestar-params";
import {Slot} from "@chainsafe/lodestar-types";
import {ILogger, sleep} from "@chainsafe/lodestar-utils";
import {ChainEvent} from "./emitter";
import {IBeaconChain} from "./interface";
import {RegenCaller} from "./regen";

/**
 * When node is synced and 1/3 slot before an epoch, we want to prepare for the next epoch
 * transition from our head so that:
 * + validators vote for block head on time through attestation
 * + validators propose blocks on time
 */
export class PrecomputeEpochScheduler {
  constructor(
    private readonly chain: IBeaconChain,
    private readonly config: IBeaconConfig,
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
  private prepareForNextEpoch = async (clockSlot: Slot): Promise<void> => {
    // only interested in last slot of epoch
    if ((clockSlot + 1) % SLOTS_PER_EPOCH !== 0) {
      return;
    }
    // Precalculate epoch transition 2/3 of the way through the last slot of the epoch
    const msToPrecalculateTime = (this.config.SECONDS_PER_SLOT * 1000 * 2) / 3;
    await sleep(msToPrecalculateTime, this.signal);
    const {slot: headSlot, blockRoot} = this.chain.forkChoice.getHead();
    const nextEpoch = computeEpochAtSlot(clockSlot) + 1;
    // node may be syncing or out of synced
    if (headSlot < clockSlot) {
      this.logger.verbose("No need to precompute epoch transition", {nextEpoch, headSlot, slot: clockSlot});
      return;
    }
    // we want to make sure headSlot === clockSlot to do early epoch transition
    const nextSlot = clockSlot + 1;
    this.logger.verbose("Precompute epoch transition", {nextEpoch, headSlot, nextSlot});
    // this takes ~2s as of Oct 2021, no need to wait for this or the clock drift
    this.chain.regen.getBlockSlotState(blockRoot, nextSlot, RegenCaller.preComputeEpoch).catch((e) => {
      this.logger.error("Failed to precompute epoch transition", nextEpoch, e);
    });
  };
}
