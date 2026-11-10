import {ATTESTATION_SUBNET_COUNT, ForkPostElectra} from "@lodestar/params";
import {EffectiveBalanceIncrements} from "@lodestar/state-transition";
import {BLSSignature, CommitteeIndex, RootHex, SingleAttestation, Slot, ValidatorIndex, phase0} from "@lodestar/types";
import {Metrics} from "../../metrics/metrics.js";
import {ProposerTracker} from "../proposerTracker.js";
import {InsertOutcome} from "./types.js";

type DataRootHex = string;

/** Position of a validator in its committee, i.e. its bit in `aggregationBits` */
type ValidatorCommitteeIndex = number;

/** `data` and `committeeIndex` are shared per data root and committee, only keep what packing reads */
type StoredSingle = {attesterIndex: ValidatorIndex; signature: BLSSignature};

type CommitteeSingles = {
  /** Bit length of this committee's `aggregationBits` */
  committeeSize: number;
  singles: Map<ValidatorCommitteeIndex, StoredSingle>;
};

type DataRootSingles = {
  /** Same for every single attestation under this data root */
  data: phase0.AttestationData;
  byCommittee: Map<CommitteeIndex, CommitteeSingles>;
};

/** Single attestations of not yet included committee members, signatures are not aggregated yet */
export type SinglesForCommittee = {
  committeeSize: number;
  singles: {validatorCommitteeIndex: ValidatorCommitteeIndex; single: StoredSingle}[];
  newSeenEffectiveBalance: number;
  newSeenAttesters: number;
};

/** Attesters of an attestation included in a block, `attestingIndices` is not sorted */
export type IncludedAttesters = {slot: Slot; attDataRootHex: DataRootHex; attestingIndices: ValidatorIndex[]};

/**
 * Backstop only, single attestations included in a canonical block are deleted (see `onHead`) so the real retention is
 * far lower. Sized for the default 8-slot window with no block at all and up to 1024 attesters per committee,
 * i.e. ~2M active validators. Beyond it, newer single attestations are dropped
 */
const MAX_SINGLE_ATTESTATIONS_RETAINED = 8 * ATTESTATION_SUBNET_COUNT * 1024;

/**
 * Single attestations to be packed into a block produced by this node, for votes that no aggregate covers.
 * Callers only add to it for vote slots of an upcoming local proposal, see `ProposerTracker.shouldCollect()`.
 * They are kept even if an aggregate covers them since proposers may not include that aggregate, until a canonical
 * block includes them.
 */
export class SingleAttestationPool {
  private readonly singlesByCommitteeByDataRootBySlot = new Map<Slot, Map<DataRootHex, DataRootSingles>>();
  private size = 0;
  /** Attesters included by the head block, deleted once a child of it becomes head */
  private pendingPrune: {blockRoot: RootHex; included: IncludedAttesters[]} | null = null;

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

    const {data, committeeIndex, attesterIndex, signature} = attestation;
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

    committee.singles.set(validatorCommitteeIndex, {attesterIndex, signature});
    this.size++;
    return InsertOutcome.NewData;
  }

  /**
   * Delete single attestations included by the parent of the new head. Not the ones of the head itself: a proposer
   * boost reorg of a weak head must keep them, once a child of it is the head that reorg can no longer happen.
   * @param included attesters of the attestations included in the new head block
   * @returns number of deleted single attestations
   */
  onHead(blockRoot: RootHex, parentRoot: RootHex, included: IncludedAttesters[]): number {
    if (this.singlesByCommitteeByDataRootBySlot.size === 0) {
      this.pendingPrune = null;
      return 0;
    }

    // a reorg or a parent imported while the pool was empty drops the pending block without deleting
    const deleted = this.pendingPrune?.blockRoot === parentRoot ? this.deleteIncluded(this.pendingPrune.included) : 0;
    this.pendingPrune = {blockRoot, included};
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

    if (this.singlesByCommitteeByDataRootBySlot.size === 0) {
      this.pendingPrune = null;
    }
  }

  isEmpty(): boolean {
    return this.singlesByCommitteeByDataRootBySlot.size === 0;
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
    // walk the smaller side, notSeenCommitteeMembers is usually tiny but close to the committee size if no aggregate
    if (notSeenCommitteeMembers.size <= committee.singles.size) {
      for (const validatorCommitteeIndex of notSeenCommitteeMembers) {
        const single = committee.singles.get(validatorCommitteeIndex);
        if (single !== undefined) {
          singles.push({validatorCommitteeIndex, single});
        }
      }
    } else {
      for (const [validatorCommitteeIndex, single] of committee.singles) {
        if (notSeenCommitteeMembers.has(validatorCommitteeIndex)) {
          singles.push({validatorCommitteeIndex, single});
        }
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

  /**
   * Delete single attestations whose votes are already on chain, they add nothing to a block built on top of it.
   * @param includedAttestations one entry per attestation in the body of a canonical block (the parent of the new
   * head): the attestation slot and data root, and the validators it covers. A single attestation is included if its
   * attester is in `attestingIndices` of an entry with the same slot and data root.
   * @returns number of deleted single attestations
   */
  private deleteIncluded(includedAttestations: IncludedAttesters[]): number {
    // a block may include several attestations of the same data, merge their attesters per data root
    const includedAttestersByDataRootBySlot = new Map<Slot, Map<DataRootHex, Set<ValidatorIndex>>>();
    for (const {slot, attDataRootHex, attestingIndices} of includedAttestations) {
      if (this.singlesByCommitteeByDataRootBySlot.get(slot)?.has(attDataRootHex) !== true) {
        continue;
      }
      let includedAttestersByDataRoot = includedAttestersByDataRootBySlot.get(slot);
      if (includedAttestersByDataRoot === undefined) {
        includedAttestersByDataRoot = new Map();
        includedAttestersByDataRootBySlot.set(slot, includedAttestersByDataRoot);
      }
      let includedAttesters = includedAttestersByDataRoot.get(attDataRootHex);
      if (includedAttesters === undefined) {
        includedAttesters = new Set();
        includedAttestersByDataRoot.set(attDataRootHex, includedAttesters);
      }
      for (const attesterIndex of attestingIndices) {
        includedAttesters.add(attesterIndex);
      }
    }

    let deleted = 0;
    for (const [slot, includedAttestersByDataRoot] of includedAttestersByDataRootBySlot) {
      const singlesByCommitteeByDataRoot = this.singlesByCommitteeByDataRootBySlot.get(slot);
      if (singlesByCommitteeByDataRoot === undefined) {
        continue;
      }

      for (const [attDataRootHex, includedAttesters] of includedAttestersByDataRoot) {
        const dataRootSingles = singlesByCommitteeByDataRoot.get(attDataRootHex);
        if (dataRootSingles === undefined) {
          continue;
        }

        for (const [committeeIndex, committee] of dataRootSingles.byCommittee) {
          for (const [validatorCommitteeIndex, {attesterIndex}] of committee.singles) {
            if (includedAttesters.has(attesterIndex)) {
              committee.singles.delete(validatorCommitteeIndex);
              deleted++;
            }
          }
          if (committee.singles.size === 0) {
            dataRootSingles.byCommittee.delete(committeeIndex);
          }
        }

        if (dataRootSingles.byCommittee.size === 0) {
          singlesByCommitteeByDataRoot.delete(attDataRootHex);
        }
      }

      if (singlesByCommitteeByDataRoot.size === 0) {
        this.singlesByCommitteeByDataRootBySlot.delete(slot);
      }
    }

    this.size -= deleted;
    return deleted;
  }
}
