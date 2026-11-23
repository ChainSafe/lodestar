import {BeaconConfig} from "@lodestar/config";
import {XMSS_CLAIM_SIZE} from "@lodestar/native/leanvm";
import {ForkName, MIN_ATTESTATION_INCLUSION_DELAY_PQ, SLOTS_PER_EPOCH} from "@lodestar/params";
import {computeEpochAtSlot, computeTimeAtSlot} from "@lodestar/state-transition";
import {CommitteeIndex, Slot} from "@lodestar/types";
import {Logger, isErrorAborted, sleep} from "@lodestar/utils";
import {ClockEvent} from "../../util/clock.js";
import {IBeaconChain} from "../interface.js";
import {PqPreparedBlock} from "../opPools/pqAttestationPool.js";
import {PREPARE_INTERVAL_MS, PqBlockHead, getPqBlockHead} from "./blockPreparer.js";
import {PqExperiment, PqTiming, PqTimingFields, SAMPLING_STRIDE, proofId} from "./timing.js";

const SCENARIOS = ["committee_only", "proposer_only", "combined"] as const;

/**
 * On a node without validators, does the proving of an aggregator and of a proposer on what the
 * network sends, to time it: every third slot anchors an experiment, which proves one committee's
 * single attestations, merges the aggregates for a block two slots on, or both. What it proves
 * stays out of the pool and off the network. The scenarios and their record are those of
 * Lighthouse's and Prysm's observers.
 */
export class PqObserver {
  private experimentCount = 0;

  constructor(
    private readonly chain: IBeaconChain,
    private readonly config: BeaconConfig,
    private readonly logger: Logger,
    private readonly signal: AbortSignal,
    private readonly timing: PqTiming,
    private readonly committeeCollectionMs: number,
    private readonly initialMergeMs: number
  ) {
    this.chain.clock.on(ClockEvent.slot, this.onSlot);
    this.signal.addEventListener("abort", () => this.chain.clock.off(ClockEvent.slot, this.onSlot), {once: true});
  }

  /** Plans the experiment anchored at the next slot, if that slot anchors one */
  private onSlot = (clockSlot: Slot): void => {
    // The clock ticks before genesis too
    if (clockSlot < 0) return;
    const anchor = clockSlot + 1;
    if (BigInt(anchor % SAMPLING_STRIDE) !== this.timing.seed % BigInt(SAMPLING_STRIDE)) return;

    this.runExperiment(anchor).catch((e) => {
      if (!isErrorAborted(e)) this.logger.error("Failed pq measurement", {anchor}, e as Error);
    });
  };

  private async runExperiment(anchor: Slot): Promise<void> {
    const scenario = SCENARIOS[Math.floor(anchor / SAMPLING_STRIDE) % SCENARIOS.length];
    const committeeSlot = scenario === "proposer_only" ? null : scenario === "combined" ? anchor + 1 : anchor;
    const targetSlot = scenario === "committee_only" ? null : anchor + MIN_ATTESTATION_INCLUSION_DELAY_PQ;

    const skip = (outcome: string): void =>
      this.timing.emit("status", "experiment_planned", {
        experiment_id: anchor,
        reference_slot: anchor,
        scenario,
        outcome,
      });
    if (this.config.getForkName(anchor) !== ForkName.pq) return skip("pre_pq");
    const head = this.chain.forkChoice.getHead();
    if (anchor - head.slot > SLOTS_PER_EPOCH) return skip("syncing");
    // The prover is theirs first
    if (this.chain.beaconProposerCache.getValidatorIndices().length > 0) return skip("local_validators");

    let shuffling: {committeesPerSlot: number; activeIndices: ArrayLike<number>};
    try {
      shuffling = this.chain.getHeadState().getShufflingAtEpoch(computeEpochAtSlot(committeeSlot ?? anchor));
    } catch {
      return skip("missing_geometry");
    }

    const experiment: PqExperiment = {
      id: anchor,
      scenario,
      committeeCount: shuffling.committeesPerSlot,
      activeValidators: shuffling.activeIndices.length,
    };
    const draw = this.experimentCount++;
    const committee =
      committeeSlot === null ? null : Number((this.timing.seed + BigInt(draw)) % BigInt(shuffling.committeesPerSlot));
    this.timing.emit("status", "experiment_planned", {
      ...this.getExperimentFields(experiment),
      outcome: "planned",
      target_slot: targetSlot,
      committee_slot: committeeSlot,
      committee,
      committee_draw: committee === null ? null : draw,
      head_root: head.blockRoot,
    });

    const parts: Promise<void>[] = [];
    if (committeeSlot !== null && committee !== null)
      parts.push(this.proveCommittee(experiment, committeeSlot, committee));
    if (targetSlot !== null) parts.push(this.mergeForBlock(experiment, targetSlot));
    await Promise.all(parts);
  }

  /** An aggregator's part: one committee's single attestations, proven when their collection ends */
  private async proveCommittee(experiment: PqExperiment, slot: Slot, committee: CommitteeIndex): Promise<void> {
    const cutoffMs = this.getSlotStartMs(slot) + this.committeeCollectionMs;
    await sleep(cutoffMs - Date.now(), this.signal);
    const fields = {...this.getExperimentFields(experiment), origin: "measurement", slot, work: "committee", round: 0};
    this.timing.emit("status", "input_cutoff", {...fields, scheduled_cutoff_wall_ns: BigInt(cutoffMs) * 1_000_000n});

    const proven = await this.chain.pqAttestationPool.proveCommittee(slot, committee, experiment);
    if (proven === null) {
      this.timing.emit("work", "job_outcome", {...fields, outcome: "no_inputs"});
      return;
    }

    const start = process.hrtime.bigint();
    const isValid = await this.chain.pq.verifyProofSets([proven]);
    if (!isValid) {
      this.timing.emit("work", "job_outcome", {...fields, outcome: "invalid_proof"});
      return;
    }
    this.timing.emit("work", "candidate_ready", {
      ...fields,
      outcome: "ready",
      committee,
      private: true,
      claims: proven.claims.length / XMSS_CLAIM_SIZE,
      verification_duration_ns: process.hrtime.bigint() - start,
      proof_id: proofId(proven.proof),
    });
  }

  /** A proposer's part: the merge for a block at `targetSlot`, redone while it gains, until the slot */
  private async mergeForBlock(experiment: PqExperiment, targetSlot: Slot): Promise<void> {
    const startMs = this.getSlotStartMs(experiment.id) + this.initialMergeMs;
    await sleep(startMs - Date.now(), this.signal);
    const fields = {...this.getExperimentFields(experiment), slot: targetSlot};
    this.timing.emit("status", "input_cutoff", {
      ...fields,
      work: "initial",
      scheduled_cutoff_wall_ns: BigInt(startMs) * 1_000_000n,
    });

    const slotStartMs = this.getSlotStartMs(targetSlot);
    let onHead: PqBlockHead | null = null;
    let merged: PqPreparedBlock | null = null;
    while (Date.now() < slotStartMs) {
      onHead = await getPqBlockHead(this.chain, targetSlot, onHead);
      merged =
        (await this.chain.pqAttestationPool.mergeForBlock(
          targetSlot,
          onHead.filters,
          slotStartMs - Date.now(),
          merged,
          experiment
        )) ?? merged;
      await sleep(PREPARE_INTERVAL_MS, this.signal);
    }

    this.timing.emit("status", "proposal_snapshot", {
      ...fields,
      nominal_snapshot_wall_ns: BigInt(slotStartMs) * 1_000_000n,
      outcome: merged ? "ready" : "no_candidate",
      round: merged?.round ?? 0,
      recursive_depth: 0,
      parent_root: onHead?.root ?? null,
      participation: merged?.participation ?? null,
      records: merged?.attestations.length ?? null,
      proof_id: merged ? proofId(merged.proof) : null,
    });
  }

  private getExperimentFields({id, scenario, committeeCount, activeValidators}: PqExperiment): PqTimingFields {
    return {
      experiment_id: id,
      sequence_id: `measurement:${id}`,
      reference_slot: id,
      scenario,
      committee_count: committeeCount,
      active_validators: activeValidators,
    };
  }

  private getSlotStartMs(slot: Slot): number {
    return computeTimeAtSlot(this.config, slot, this.chain.genesisTime) * 1000;
  }
}
