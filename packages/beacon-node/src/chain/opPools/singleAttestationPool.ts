import {BitArray} from "@chainsafe/ssz";
import {ATTESTATION_SUBNET_COUNT, ForkPostElectra} from "@lodestar/params";
import {EffectiveBalanceIncrements} from "@lodestar/state-transition";
import {CommitteeIndex, SingleAttestation, Slot, phase0} from "@lodestar/types";
import {Metrics} from "../../metrics/metrics.js";
import {ProposerTracker} from "../proposerTracker.js";
import {InsertOutcome} from "./types.js";

type DataRootHex = string;

/** Position of a validator in its committee, i.e. its bit in `aggregationBits` */
type ValidatorCommitteeIndex = number;

type CommitteeSingles = {
  /** Bit length of this committee's `aggregationBits` */
  committeeSize: number;
  singles: Map<ValidatorCommitteeIndex, SingleAttestation<ForkPostElectra>>;
};

type DataRootSingles = {
  /** Same for every single attestation under this data root */
  data: phase0.AttestationData;
  byCommittee: Map<CommitteeIndex, CommitteeSingles>;
};

/** Single attestations of not yet included committee members, signatures are not aggregated yet */
export type SinglesForCommittee = {
  committeeSize: number;
  singles: {validatorCommitteeIndex: ValidatorCommitteeIndex; single: SingleAttestation<ForkPostElectra>}[];
  newSeenEffectiveBalance: number;
  newSeenAttesters: number;
};

/**
 * Backstop only, single attestations covered by a validated aggregate are deleted on arrival of that aggregate so the
 * real retention is far lower. Sized for the default 8-slot window with no aggregate at all (e.g. during non-finality)
 * and up to 1024 attesters per committee, i.e. ~2M active validators. Beyond it, newer single attestations are dropped
 */
const MAX_SINGLE_ATTESTATIONS_RETAINED = 8 * ATTESTATION_SUBNET_COUNT * 1024;

/**
 * Single attestations to be packed into a block produced by this node, for votes that no aggregate covers.
 * Callers only add to it for vote slots of an upcoming local proposal, see `ProposerTracker.shouldCollect()`.
 */
export class SingleAttestationPool {
  private readonly singlesByCommitteeByDataRootBySlot = new Map<Slot, Map<DataRootHex, DataRootSingles>>();
  private size = 0;

  constructor(metrics: Metrics | null = null) {
    metrics?.opPool.singleAttestationPool.size.addCollect(() =>
      metrics.opPool.singleAttestationPool.size.set(this.size)
    );
  }

  /**
   * @param validatorCommitteeIndex position of the attester in its committee, computed by gossip validation
   */
  add(
    attestation: SingleAttestation<ForkPostElectra>,
    attDataRootHex: DataRootHex,
    validatorCommitteeIndex: ValidatorCommitteeIndex,
    committeeSize: number
  ): InsertOutcome {
    if (this.size >= MAX_SINGLE_ATTESTATIONS_RETAINED) {
      return InsertOutcome.ReachLimit;
    }

    const {data, committeeIndex} = attestation;
    let singlesByCommitteeByDataRoot = this.singlesByCommitteeByDataRootBySlot.get(data.slot);
    if (singlesByCommitteeByDataRoot === undefined) {
      singlesByCommitteeByDataRoot = new Map();
      this.singlesByCommitteeByDataRootBySlot.set(data.slot, singlesByCommitteeByDataRoot);
    }

    let dataRootSingles = singlesByCommitteeByDataRoot.get(attDataRootHex);
    if (dataRootSingles === undefined) {
      dataRootSingles = {data, byCommittee: new Map()};
      singlesByCommitteeByDataRoot.set(attDataRootHex, dataRootSingles);
    }

    let committee = dataRootSingles.byCommittee.get(committeeIndex);
    if (committee === undefined) {
      committee = {committeeSize, singles: new Map()};
      dataRootSingles.byCommittee.set(committeeIndex, committee);
    }

    if (committee.singles.has(validatorCommitteeIndex)) {
      return InsertOutcome.AlreadyKnown;
    }

    committee.singles.set(validatorCommitteeIndex, attestation);
    this.size++;
    return InsertOutcome.NewData;
  }

  /**
   * A validated aggregate covers these committee members, their single attestations are not needed anymore.
   * If AggregatedAttestationPool later drops this aggregate (more than 8 aggregates for the same data and committee),
   * these members are covered by neither, accepted as rare.
   * @returns number of deleted single attestations
   */
  onAggregate(
    slot: Slot,
    attDataRootHex: DataRootHex,
    committeeIndex: CommitteeIndex,
    aggregationBits: BitArray
  ): number {
    const committee = this.singlesByCommitteeByDataRootBySlot
      .get(slot)
      ?.get(attDataRootHex)
      ?.byCommittee.get(committeeIndex);
    if (committee === undefined) {
      return 0;
    }

    let deleted = 0;
    for (const validatorCommitteeIndex of committee.singles.keys()) {
      if (aggregationBits.get(validatorCommitteeIndex)) {
        committee.singles.delete(validatorCommitteeIndex);
        deleted++;
      }
    }
    this.size -= deleted;
    return deleted;
  }

  /** Drop vote slots that no upcoming local proposal can include */
  prune(proposerTracker: ProposerTracker): void {
    for (const [slot, singlesByCommitteeByDataRoot] of this.singlesByCommitteeByDataRootBySlot) {
      if (proposerTracker.shouldCollect(slot)) {
        continue;
      }

      for (const dataRootSingles of singlesByCommitteeByDataRoot.values()) {
        for (const committee of dataRootSingles.byCommittee.values()) {
          this.size -= committee.singles.size;
        }
      }
      this.singlesByCommitteeByDataRootBySlot.delete(slot);
    }
  }

  getStoredSlots(): Slot[] {
    return Array.from(this.singlesByCommitteeByDataRootBySlot.keys());
  }

  getDataRoots(slot: Slot): Map<DataRootHex, phase0.AttestationData> {
    const dataRoots = new Map<DataRootHex, phase0.AttestationData>();
    for (const [attDataRootHex, dataRootSingles] of this.singlesByCommitteeByDataRootBySlot.get(slot) ?? []) {
      dataRoots.set(attDataRootHex, dataRootSingles.data);
    }
    return dataRoots;
  }

  getCommitteeIndices(slot: Slot, attDataRootHex: DataRootHex): CommitteeIndex[] {
    return Array.from(this.singlesByCommitteeByDataRootBySlot.get(slot)?.get(attDataRootHex)?.byCommittee.keys() ?? []);
  }

  /**
   * Single attestations of a committee whose attesters are in `notSeenCommitteeMembers`, i.e. not on chain and not
   * covered by the aggregates picked for the block. `notSeenCommitteeMembers` is only read.
   * Returns at most `maxCount` single attestations with the highest effective balances, without removing them from the
   * pool.
   */
  getUncovered(
    slot: Slot,
    attDataRootHex: DataRootHex,
    committeeIndex: CommitteeIndex,
    notSeenCommitteeMembers: ReadonlySet<ValidatorCommitteeIndex>,
    effectiveBalanceIncrements: EffectiveBalanceIncrements,
    maxCount: number
  ): SinglesForCommittee | null {
    const committee = this.singlesByCommitteeByDataRootBySlot
      .get(slot)
      ?.get(attDataRootHex)
      ?.byCommittee.get(committeeIndex);
    if (committee === undefined) {
      return null;
    }

    const singles: SinglesForCommittee["singles"] = [];
    for (const [validatorCommitteeIndex, single] of committee.singles) {
      if (notSeenCommitteeMembers.has(validatorCommitteeIndex)) {
        singles.push({validatorCommitteeIndex, single});
      }
    }
    if (singles.length > maxCount) {
      singles.sort(
        (a, b) =>
          effectiveBalanceIncrements[b.single.attesterIndex] - effectiveBalanceIncrements[a.single.attesterIndex]
      );
      singles.length = maxCount;
    }
    if (singles.length === 0) {
      return null;
    }

    let newSeenEffectiveBalance = 0;
    for (const {single} of singles) {
      newSeenEffectiveBalance += effectiveBalanceIncrements[single.attesterIndex];
    }
    return {committeeSize: committee.committeeSize, singles, newSeenEffectiveBalance, newSeenAttesters: singles.length};
  }
}
