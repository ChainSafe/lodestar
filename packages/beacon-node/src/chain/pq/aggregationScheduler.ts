import {ChainForkConfig} from "@lodestar/config";
import {ForkName, SLOTS_PER_EPOCH} from "@lodestar/params";
import {computeTimeAtSlot} from "@lodestar/state-transition";
import {CommitteeIndex, Slot} from "@lodestar/types";
import {Logger, MapDef, isErrorAborted, sleep} from "@lodestar/utils";
import {ClockEvent} from "../../util/clock.js";
import {IBeaconChain} from "../interface.js";

/** A validator client names its aggregators for the current epoch and the next */
const MAX_SLOTS_AHEAD = 2 * SLOTS_PER_EPOCH;

/**
 * From pq an aggregate is a proof, and proving takes a second or more. For each committee a
 * validator of this node aggregates, this has the pool prove ahead of the aggregate's deadline,
 * `proveAtMs` into the slot, for the validator client to fetch the proof when it is due. An
 * attestation that comes after is not in the aggregate.
 */
export class PqAggregationScheduler {
  private readonly committeesBySlot = new MapDef<Slot, Set<CommitteeIndex>>(() => new Set());

  constructor(
    private readonly chain: IBeaconChain,
    private readonly config: ChainForkConfig,
    private readonly proveAtMs: number,
    private readonly logger: Logger,
    private readonly signal: AbortSignal
  ) {
    this.chain.clock.on(ClockEvent.slot, this.onSlot);
    this.signal.addEventListener("abort", () => this.chain.clock.off(ClockEvent.slot, this.onSlot), {once: true});
  }

  /**
   * Records that a validator of this node aggregates for a committee of a slot to come. One named
   * in its slot or after is not proven for ahead: the pool then proves when the aggregate is asked.
   */
  addAggregator(slot: Slot, committeeIndex: CommitteeIndex): void {
    const clockSlot = this.chain.clock.currentSlot;
    if (slot <= clockSlot || slot > clockSlot + MAX_SLOTS_AHEAD) return;
    if (this.config.getForkName(slot) !== ForkName.pq) return;
    this.committeesBySlot.getOrDefault(slot).add(committeeIndex);
  }

  private onSlot = (clockSlot: Slot): void => {
    const committeeIndices = this.committeesBySlot.get(clockSlot);
    for (const slot of this.committeesBySlot.keys()) {
      if (slot <= clockSlot) this.committeesBySlot.delete(slot);
    }
    if (!committeeIndices) return;

    for (const committeeIndex of committeeIndices) {
      this.proveAhead(clockSlot, committeeIndex).catch((e) => {
        if (!isErrorAborted(e)) {
          this.logger.error("Failed to prove pq aggregate ahead", {slot: clockSlot, committeeIndex}, e as Error);
        }
      });
    }
  };

  private async proveAhead(slot: Slot, committeeIndex: CommitteeIndex): Promise<void> {
    const proveAtMs = computeTimeAtSlot(this.config, slot, this.chain.genesisTime) * 1000 + this.proveAtMs;
    await sleep(proveAtMs - Date.now(), this.signal);
    await this.chain.pqAttestationPool.proveAggregate(slot, committeeIndex);
  }
}
