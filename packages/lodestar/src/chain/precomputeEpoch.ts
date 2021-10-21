import {AbortSignal} from "@chainsafe/abort-controller";
import {computeStartSlotAtEpoch} from "@chainsafe/lodestar-beacon-state-transition";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {SLOTS_PER_EPOCH} from "@chainsafe/lodestar-params";
import {Epoch} from "@chainsafe/lodestar-types";
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
    this.chain.emitter.on(ChainEvent.clockEpoch, this.onEpoch);

    this.signal.addEventListener(
      "abort",
      () => {
        this.chain.emitter.off(ChainEvent.clockEpoch, this.onEpoch);
      },
      {once: true}
    );
  }

  private onEpoch = async (epoch: Epoch): Promise<void> => {
    // Precalculate epoch transition 2/3 of the way through the last slot of the epoch
    const msSecondsPerSlot = this.config.SECONDS_PER_SLOT * 1000;
    const msToPrecalculateTime = msSecondsPerSlot * (SLOTS_PER_EPOCH - 1 / 3);
    await sleep(msToPrecalculateTime, this.signal);
    const clockSlot = this.chain.clock.currentSlot;
    const {slot: headSlot, blockRoot} = this.chain.forkChoice.getHead();
    // node may be syncing or out of synced
    if (headSlot < clockSlot) {
      this.logger.verbose("No need to precompute epoch transition", {headSlot, clockSlot});
      return;
    }
    // we want to make sure headSlot === clockSlot to do early epoch transition
    const nextSlot = computeStartSlotAtEpoch(epoch + 1);
    this.logger.verbose("Precompute epoch transition", {epoch, headSlot, nextSlot});
    await this.chain.regen.getBlockSlotState(blockRoot, nextSlot, RegenCaller.preComputeEpoch).catch((e) => {
      this.logger.error("Failed to precompute epoch transition", epoch, e);
    });
  };
}
