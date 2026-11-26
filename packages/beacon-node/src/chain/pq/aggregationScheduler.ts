import {ChainForkConfig} from "@lodestar/config";
import {ForkName, SLOTS_PER_EPOCH} from "@lodestar/params";
import {IBeaconStateViewGloas, computeTimeAtSlot} from "@lodestar/state-transition";
import {CommitteeIndex, Slot, ValidatorIndex} from "@lodestar/types";
import {Logger, MapDef, isErrorAborted, sleep} from "@lodestar/utils";
import {ClockEvent} from "../../util/clock.js";
import {IBeaconChain} from "../interface.js";

/** A validator client names its aggregators for the current epoch and the next */
const MAX_SLOTS_AHEAD = 2 * SLOTS_PER_EPOCH;

/**
 * From pq the aggregators of a committee take turns: the one at a position in the aggregation
 * committee stops collecting attestations at its cutoff and publishes when its aggregate is due,
 * each a delay later than the position before. Proving takes the time between the two, so for
 * each committee a validator of this node aggregates, this has the pool prove at the cutoff, for
 * the validator client to fetch the proof when it is due.
 *
 * Of several aggregators of one committee only the first is served: its aggregate is the first a
 * proposer can include, and the prover runs one proof at a time.
 *
 * https://github.com/ethereum/consensus-specs/blob/4595f0fc9be7e3611f0187a2ff5fee00e120f751/specs/_features/pq/validator.md#construct-aggregate
 */
export class PqAggregationScheduler {
  private readonly aggregatorsBySlot = new MapDef<Slot, MapDef<CommitteeIndex, Set<ValidatorIndex>>>(
    () => new MapDef<CommitteeIndex, Set<ValidatorIndex>>(() => new Set())
  );

  constructor(
    private readonly chain: IBeaconChain,
    private readonly config: ChainForkConfig,
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
  addAggregator(slot: Slot, committeeIndex: CommitteeIndex, validatorIndex: ValidatorIndex): void {
    const clockSlot = this.chain.clock.currentSlot;
    if (slot <= clockSlot || slot > clockSlot + MAX_SLOTS_AHEAD) return;
    if (this.config.getForkName(slot) !== ForkName.pq) return;
    this.aggregatorsBySlot.getOrDefault(slot).getOrDefault(committeeIndex).add(validatorIndex);
  }

  private onSlot = (clockSlot: Slot): void => {
    const byCommittee = this.aggregatorsBySlot.get(clockSlot);
    for (const slot of this.aggregatorsBySlot.keys()) {
      if (slot <= clockSlot) this.aggregatorsBySlot.delete(slot);
    }
    if (!byCommittee) return;

    for (const [committeeIndex, validatorIndices] of byCommittee) {
      this.proveAtCutoff(clockSlot, committeeIndex, validatorIndices).catch((e) => {
        if (!isErrorAborted(e)) {
          this.logger.error("Failed to prove pq aggregate ahead", {slot: clockSlot, committeeIndex}, e as Error);
        }
      });
    }
  };

  private async proveAtCutoff(
    slot: Slot,
    committeeIndex: CommitteeIndex,
    validatorIndices: Set<ValidatorIndex>
  ): Promise<void> {
    const state = this.chain.getHeadState() as IBeaconStateViewGloas;
    const position = state
      .getAggregationCommittee(slot, committeeIndex)
      .findIndex((validatorIndex) => validatorIndices.has(validatorIndex));
    if (position === -1) return;

    const cutoffMs =
      computeTimeAtSlot(this.config, slot, this.chain.genesisTime) * 1000 +
      this.config.getAggregationCutoffMs(ForkName.pq, position);
    await sleep(cutoffMs - Date.now(), this.signal);
    await this.chain.pqAttestationPool.proveAggregate(slot, committeeIndex);
  }
}
