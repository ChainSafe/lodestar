import {BitArray} from "@chainsafe/ssz";
import {
  XMSS_AGGREGATE_MAX_CHILDREN,
  XMSS_SIGNED_SIZE,
  XmssAggregate,
  aggregateXmssSignatures,
} from "@lodestar/native/leanvm";
import {
  MAX_ATTESTATIONS_PQ,
  MAX_COMMITTEES_PER_SLOT_PQ,
  MIN_ATTESTATION_INCLUSION_DELAY_PQ,
  SLOTS_PER_EPOCH,
} from "@lodestar/params";
import {IBeaconStateView, IBeaconStateViewAltair, computeEpochAtSlot} from "@lodestar/state-transition";
import {CommitteeIndex, Epoch, RootHex, Slot, phase0, pq} from "@lodestar/types";
import {MapDef, byteArrayEquals, sleep} from "@lodestar/utils";
import {PqExperiment, PqTiming, PqTimingFields, PqTimingJob, proofId} from "../pq/timing.js";
import {canonicalClaims} from "../pq/verifier.js";
import {InsertOutcome} from "./types.js";
import {pruneBySlot} from "./utils.js";

/** Slots of attestations kept: what a block may still include */
const SLOTS_RETAINED = SLOTS_PER_EPOCH;

/**
 * leanVM's code rate for attestation proofs, as `2^-PROOF_LOG_INV_RATE`. A higher value is a
 * smaller proof and a slower prover.
 */
export const PROOF_LOG_INV_RATE = 2;

/** An aggregate of one committee's attestation, with the proof of its attesters' signatures */
export type PqAggregate = {
  aggregationBits: BitArray;
  aggregate: XmssAggregate;
};

type CommitteeAttestations = {
  committeeSize: number;
  /** Signed claims of single attestations, by the attester's position in the committee */
  signed: Map<number, Uint8Array>;
  /** Proven aggregates, from the network or from `signed` */
  aggregates: PqAggregate[];
};

type DataAttestations = {
  data: phase0.AttestationData;
  byCommittee: Map<CommitteeIndex, CommitteeAttestations>;
};

export type PqBlockAttestations = {
  attestations: pq.Attestation[];
  /** One proof of the signatures of every attester of `attestations`. Empty if there are none. */
  proof: Uint8Array;
  /**
   * Where they are from: merged ahead of the slot, merged for this call, or none because the pool
   * has none to add (`empty`) or their merge did not end in time (`late`)
   */
  source: "prepared" | "merged" | "empty" | "late";
};

/** What a state accepts and what it already has, for a block at one slot */
export type PqAttestationFilters = {
  /** Whether the state accepts an attestation's data: its target epoch and source checkpoint */
  isIncludable: (data: phase0.AttestationData) => boolean;
  /**
   * For a committee of an attestation's data, whether the attester at a position in it already
   * has an attestation for the target epoch in the state
   */
  isOnChain: (data: phase0.AttestationData, committeeIndex: CommitteeIndex) => (position: number) => boolean;
};

/** A committee's attesters in a selection, by position */
type SelectedCommittee = {data: phase0.AttestationData; committeeIndex: CommitteeIndex; positions: number[]};

type Selection = {
  attestations: pq.Attestation[];
  children: XmssAggregate[];
  signed: Uint8Array[];
  committees: SelectedCommittee[];
};

/** The attestations merged for a block, and their proof */
export type PqPreparedBlock = {
  attestations: pq.Attestation[];
  proof: Uint8Array;
  committees: SelectedCommittee[];
  /** Attesters it added to the state it was merged against */
  participation: number;
  /** How many merges the block has had, this one counted */
  round: number;
};

/** A merge is taken to last this many times the last one, plus the slack, when asking if it fits */
const MERGE_TIME_FACTOR = 1.6;
const MERGE_TIME_SLACK_MS = 500;

/**
 * Attestations from the pq fork on. An attestation carries no signature, so aggregating is
 * proving: this pool keeps the leanXMSS signatures of single attestations and the proofs of
 * aggregates, proves a committee's signatures for an aggregator, and merges proofs into the one a
 * block carries.
 *
 * Proving takes seconds and leanVM runs one proof at a time, so every method that proves is
 * asynchronous and may queue behind another.
 */
export class PqAttestationPool {
  private readonly byRootBySlot = new MapDef<Slot, Map<RootHex, DataAttestations>>(() => new Map());
  private lowestPermissibleSlot = 0;
  /** Attestations merged ahead of the slot of the block they are for */
  private readonly preparedBySlot = new Map<Slot, PqPreparedBlock>();
  private preparing = false;
  private lastMergeMs = 0;

  constructor(private readonly timing: PqTiming | null = null) {}

  /**
   * Adds a single attestation whose signature is verified. `signed` is its packed signed claim:
   * the attester's public key, the signing root, then the signature.
   */
  addSingle(
    committeeIndex: CommitteeIndex,
    data: phase0.AttestationData,
    dataRootHex: RootHex,
    validatorCommitteeIndex: number,
    committeeSize: number,
    signed: Uint8Array
  ): InsertOutcome {
    if (data.slot < this.lowestPermissibleSlot) return InsertOutcome.Old;
    if (signed.length !== XMSS_SIGNED_SIZE) throw Error(`A signed claim is ${XMSS_SIGNED_SIZE} bytes`);

    const committee = this.getCommittee(data, dataRootHex, committeeIndex, committeeSize);
    if (committee.signed.has(validatorCommitteeIndex)) return InsertOutcome.AlreadyKnown;
    committee.signed.set(validatorCommitteeIndex, signed);
    return InsertOutcome.NewData;
  }

  /**
   * Adds an aggregate of one committee whose proof is verified. `claims` are the claims the proof
   * covers, in any order.
   */
  addAggregate(
    committeeIndex: CommitteeIndex,
    data: phase0.AttestationData,
    dataRootHex: RootHex,
    aggregationBits: BitArray,
    proof: Uint8Array,
    claims: Uint8Array
  ): InsertOutcome {
    if (data.slot < this.lowestPermissibleSlot) return InsertOutcome.Old;

    const committee = this.getCommittee(data, dataRootHex, committeeIndex, aggregationBits.bitLen);
    for (const known of committee.aggregates) {
      if (isSuperset(known.aggregationBits, aggregationBits)) return InsertOutcome.AlreadyKnown;
    }
    committee.aggregates.push({aggregationBits, aggregate: {proof, claims: canonicalClaims(claims)}});
    return InsertOutcome.Aggregated;
  }

  /**
   * For an aggregator: the aggregate of every single attestation seen for a committee, with a
   * fresh proof of their signatures. Null if there are none.
   */
  async getAggregate(
    slot: Slot,
    dataRootHex: RootHex,
    committeeIndex: CommitteeIndex
  ): Promise<{data: phase0.AttestationData; aggregate: PqAggregate} | null> {
    const dataAttestations = this.byRootBySlot.get(slot)?.get(dataRootHex);
    const committee = dataAttestations?.byCommittee.get(committeeIndex);
    if (!dataAttestations || !committee || committee.signed.size === 0) return null;

    // Another aggregator of the committee, or a retry, may have had the same signatures proven
    const bits = signedBits(committee);
    const proven = committee.aggregates.find(({aggregationBits}) => isSameBits(aggregationBits, bits));
    if (proven) return {data: dataAttestations.data, aggregate: proven};

    const job = this.timing?.job("committee", slot, 0);
    const aggregate = await proveSigned(committee, job, {committee: committeeIndex});
    job?.emit("candidate_ready", "ready", {committee: committeeIndex, proof_id: proofId(aggregate.aggregate.proof)});
    committee.aggregates.push(aggregate);
    return {data: dataAttestations.data, aggregate};
  }

  /**
   * Merges the attestations for a block at `blockSlot` ahead of the slot, for
   * `getAttestationsForBlock` to return. Called again, it merges anew if the pool now has more
   * attesters to add than what it holds and the merge is likely to end within `msToSlot`: a merge
   * holds the prover while it runs.
   */
  async prepareBlock(blockSlot: Slot, filters: PqAttestationFilters, msToSlot: number): Promise<void> {
    const prepared = await this.mergeForBlock(blockSlot, filters, msToSlot, this.preparedBySlot.get(blockSlot) ?? null);
    if (prepared) this.preparedBySlot.set(blockSlot, prepared);
  }

  /**
   * What `prepareBlock` merges, returned and not kept: the merge of the attestations for a block
   * at `blockSlot`, if it adds attesters to `held`, the merge before it, and is likely to end
   * within `msToSlot`. Null otherwise. `experiment` is what an observer merges for.
   */
  async mergeForBlock(
    blockSlot: Slot,
    filters: PqAttestationFilters,
    msToSlot: number,
    held: PqPreparedBlock | null,
    experiment?: PqExperiment
  ): Promise<PqPreparedBlock | null> {
    if (this.preparing) return null;
    const selection = this.select(blockSlot, filters);
    const participation = countNew(selection.committees, filters);
    const isHeldIncludable = held?.attestations.every(({data}) => filters.isIncludable(data)) === true;
    if (participation <= (isHeldIncludable ? countNew(held.committees, filters) : 0)) return null;
    if (this.lastMergeMs * MERGE_TIME_FACTOR + MERGE_TIME_SLACK_MS > msToSlot) return null;

    const round = (held?.round ?? 0) + 1;
    const job = this.timing?.job(round === 1 ? "initial" : "improvement", blockSlot, round, experiment);
    const fields = {
      input_proof_count: selection.children.length,
      records: selection.attestations.length,
      participation,
    };
    // One aggregate and nothing else is its own merge
    const isReuse = selection.children.length === 1 && selection.signed.length === 0;

    this.preparing = true;
    try {
      const start = Date.now();
      const {proof} = isReuse
        ? selection.children[0]
        : await timed(job, fields, () => merge(selection.children, selection.signed));
      if (isReuse) {
        job?.emit("job_outcome", "reused", {proof_id: proofId(proof)});
      } else {
        this.lastMergeMs = Date.now() - start;
      }
      job?.emit("candidate_ready", "ready", {
        ...fields,
        proof_id: proofId(proof),
        recursive_depth: 0,
        backend_call: !isReuse,
      });
      return {attestations: selection.attestations, proof, committees: selection.committees, participation, round};
    } finally {
      this.preparing = false;
    }
  }

  /**
   * For an observer: a proof of the single attestations seen for a committee, those of the
   * attestation data most of them are for. It is not kept, so no aggregator or proposer of this
   * node uses it. Null if there are none.
   */
  async proveCommittee(
    slot: Slot,
    committeeIndex: CommitteeIndex,
    experiment: PqExperiment
  ): Promise<XmssAggregate | null> {
    let most: CommitteeAttestations | null = null;
    for (const {byCommittee} of this.byRootBySlot.get(slot)?.values() ?? []) {
      const committee = byCommittee.get(committeeIndex);
      if (committee && committee.signed.size > (most?.signed.size ?? 0)) most = committee;
    }
    if (!most) return null;
    const job = this.timing?.job("committee", slot, 0, experiment);
    return (await proveSigned(most, job, {committee: committeeIndex})).aggregate;
  }

  /**
   * The attestations for a block at `blockSlot` and the proof of all their signatures: those
   * merged ahead of the slot if the state still accepts them, else merged now. A merge that does
   * not end within `timeoutMs` is given up for a block without attestations, which is worth more
   * than a late one.
   */
  async getAttestationsForBlock(
    blockSlot: Slot,
    filters: PqAttestationFilters,
    timeoutMs: number
  ): Promise<PqBlockAttestations> {
    const prepared = this.getPrepared(blockSlot, filters);
    this.timing?.onProposal(
      blockSlot,
      prepared && {
        proof: prepared.proof,
        participation: countNew(prepared.committees, filters),
        records: prepared.attestations.length,
      }
    );
    if (prepared) return {attestations: prepared.attestations, proof: prepared.proof, source: "prepared"};

    const {attestations, children, signed, committees} = this.select(blockSlot, filters);
    if (attestations.length === 0) return {attestations, proof: new Uint8Array(0), source: "empty"};

    const merging = timed(
      this.timing?.job("fallback", blockSlot, 1),
      {input_proof_count: children.length, records: attestations.length, participation: countNew(committees, filters)},
      () => merge(children, signed)
    );
    // Once given up, its failure is no one's to handle
    merging.catch(() => {});
    const merged = await Promise.race([merging, sleep(timeoutMs).then(() => null)]);
    if (merged === null) return {attestations: [], proof: new Uint8Array(0), source: "late"};
    return {attestations, proof: merged.proof, source: "merged"};
  }

  /** What was merged for a block at `blockSlot`, if the state accepts every attestation of it */
  private getPrepared(blockSlot: Slot, {isIncludable}: PqAttestationFilters): PqPreparedBlock | null {
    const prepared = this.preparedBySlot.get(blockSlot);
    return prepared?.attestations.every(({data}) => isIncludable(data)) ? prepared : null;
  }

  /**
   * The attestations to add to a block at `blockSlot`, and what proves them. A committee that
   * adds no attester to the state is left out, as proving it again buys nothing.
   */
  private select(blockSlot: Slot, {isIncludable, isOnChain}: PqAttestationFilters): Selection {
    const attestations: pq.Attestation[] = [];
    const children: XmssAggregate[] = [];
    const signed: Uint8Array[] = [];
    const committees: SelectedCommittee[] = [];

    // Newest first: recent attestations earn the proposer more
    const slots = Array.from(this.byRootBySlot.keys())
      .filter((slot) => slot + MIN_ATTESTATION_INCLUSION_DELAY_PQ <= blockSlot && slot + SLOTS_PER_EPOCH >= blockSlot)
      .sort((a, b) => b - a);

    for (const slot of slots) {
      for (const {data, byCommittee} of (this.byRootBySlot.get(slot) as Map<RootHex, DataAttestations>).values()) {
        if (attestations.length >= MAX_ATTESTATIONS_PQ) break;
        if (!isIncludable(data)) continue;

        // An on chain aggregate covers the committees of one attestation data, in committee order
        const committeeBits = BitArray.fromBitLen(MAX_COMMITTEES_PER_SLOT_PQ);
        const bits: boolean[] = [];
        for (const committeeIndex of Array.from(byCommittee.keys()).sort((a, b) => a - b)) {
          const committee = byCommittee.get(committeeIndex) as CommitteeAttestations;
          const best = bestAggregate(committee);
          // No aggregate may have reached this node, or none as large as its single attestations
          const useAggregate =
            best !== null && best.aggregationBits.getTrueBitIndexes().length >= committee.signed.size;
          const committeeBitsArr = useAggregate ? best.aggregationBits : signedBits(committee);
          const positions = committeeBitsArr.getTrueBitIndexes();
          if (positions.every(isOnChain(data, committeeIndex))) continue;

          if (useAggregate) {
            children.push(best.aggregate);
          } else {
            signed.push(...committee.signed.values());
          }
          bits.push(...committeeBitsArr.toBoolArray());
          committeeBits.set(committeeIndex, true);
          committees.push({data, committeeIndex, positions});
        }
        if (bits.length === 0) continue;
        attestations.push({aggregationBits: BitArray.fromBoolArray(bits), data, committeeBits});
      }
    }

    return {attestations, children, signed, committees};
  }

  /** Every aggregate held, for the API */
  getAll(bySlot?: Slot): {data: phase0.AttestationData; committeeIndex: CommitteeIndex; aggregate: PqAggregate}[] {
    const out = [];
    for (const [slot, byRoot] of this.byRootBySlot) {
      if (bySlot !== undefined && slot !== bySlot) continue;
      for (const {data, byCommittee} of byRoot.values()) {
        for (const [committeeIndex, committee] of byCommittee) {
          for (const aggregate of committee.aggregates) out.push({data, committeeIndex, aggregate});
        }
      }
    }
    return out;
  }

  prune(clockSlot: Slot): void {
    pruneBySlot(this.byRootBySlot, clockSlot, SLOTS_RETAINED);
    for (const blockSlot of this.preparedBySlot.keys()) {
      if (blockSlot < clockSlot) this.preparedBySlot.delete(blockSlot);
    }
    this.lowestPermissibleSlot = Math.max(clockSlot - SLOTS_RETAINED, 0);
  }

  private getCommittee(
    data: phase0.AttestationData,
    dataRootHex: RootHex,
    committeeIndex: CommitteeIndex,
    committeeSize: number
  ): CommitteeAttestations {
    const byRoot = this.byRootBySlot.getOrDefault(data.slot);
    let dataAttestations = byRoot.get(dataRootHex);
    if (!dataAttestations) {
      dataAttestations = {data, byCommittee: new Map()};
      byRoot.set(dataRootHex, dataAttestations);
    }
    let committee = dataAttestations.byCommittee.get(committeeIndex);
    if (!committee) {
      committee = {committeeSize, signed: new Map(), aggregates: []};
      dataAttestations.byCommittee.set(committeeIndex, committee);
    }
    return committee;
  }
}

/** The target epochs an attestation in a block at `blockSlot` may have */
export function includableTargetEpochs(blockEpoch: Epoch): Epoch[] {
  return blockEpoch === 0 ? [0] : [blockEpoch - 1, blockEpoch];
}

/** The filters of `state`, the state a block at `blockSlot` is built on, dialed to that slot */
export function getPqAttestationFilters(state: IBeaconStateView, blockSlot: Slot): PqAttestationFilters {
  const blockEpoch = computeEpochAtSlot(blockSlot);
  const stateAltair = state as IBeaconStateViewAltair;
  return {
    isIncludable: (data) => {
      const justified =
        data.target.epoch === blockEpoch
          ? state.currentJustifiedCheckpoint
          : data.target.epoch === blockEpoch - 1
            ? state.previousJustifiedCheckpoint
            : null;
      return (
        justified !== null && data.source.epoch === justified.epoch && byteArrayEquals(data.source.root, justified.root)
      );
    },
    isOnChain: (data, committeeIndex) => {
      const committee = state.getBeaconCommittee(data.slot, committeeIndex);
      const participation =
        data.target.epoch === blockEpoch
          ? stateAltair.currentEpochParticipation
          : stateAltair.previousEpochParticipation;
      return (position) => participation[committee[position]] !== 0;
    },
  };
}

/** Attesters of `committees` without an attestation for their target epoch in the state */
function countNew(committees: SelectedCommittee[], {isOnChain}: PqAttestationFilters): number {
  let count = 0;
  for (const {data, committeeIndex, positions} of committees) {
    const onChain = isOnChain(data, committeeIndex);
    for (const position of positions) {
      if (!onChain(position)) count++;
    }
  }
  return count;
}

function signedBits(committee: CommitteeAttestations): BitArray {
  const bits = BitArray.fromBitLen(committee.committeeSize);
  for (const position of committee.signed.keys()) bits.set(position, true);
  return bits;
}

async function proveSigned(
  committee: CommitteeAttestations,
  job?: PqTimingJob,
  fields?: PqTimingFields
): Promise<PqAggregate> {
  const aggregationBits = signedBits(committee);
  const aggregate = await timed(
    job,
    {...fields, signature_count: committee.signed.size, committee_size: committee.committeeSize},
    () => aggregateXmssSignatures([], Buffer.concat(Array.from(committee.signed.values())), PROOF_LOG_INV_RATE)
  );
  return {aggregationBits, aggregate};
}

function timed(
  job: PqTimingJob | undefined,
  fields: PqTimingFields,
  prove: () => Promise<XmssAggregate>
): Promise<XmssAggregate> {
  return job ? job.run(prove, fields) : prove();
}

function bestAggregate(committee: CommitteeAttestations): PqAggregate | null {
  let best: PqAggregate | null = null;
  let bestCount = 0;
  for (const aggregate of committee.aggregates) {
    const count = aggregate.aggregationBits.getTrueBitIndexes().length;
    if (count > bestCount) {
      best = aggregate;
      bestCount = count;
    }
  }
  return best;
}

function isSameBits(a: BitArray, b: BitArray): boolean {
  return a.bitLen === b.bitLen && Buffer.compare(a.uint8Array, b.uint8Array) === 0;
}

function isSuperset(a: BitArray, b: BitArray): boolean {
  if (a.bitLen !== b.bitLen) return false;
  for (let i = 0; i < a.uint8Array.length; i++) {
    if ((a.uint8Array[i] & b.uint8Array[i]) !== b.uint8Array[i]) return false;
  }
  return true;
}

/**
 * One proof of everything `children` and `signed` claim. leanVM merges a bounded number of
 * children at once, so more are merged in rounds.
 */
async function merge(children: XmssAggregate[], signed: Uint8Array[]): Promise<XmssAggregate> {
  if (children.length === 1 && signed.length === 0) return children[0];

  let level = children;
  let raw = Buffer.concat(signed);
  while (level.length > XMSS_AGGREGATE_MAX_CHILDREN) {
    const next: XmssAggregate[] = [];
    for (let i = 0; i < level.length; i += XMSS_AGGREGATE_MAX_CHILDREN) {
      const group = level.slice(i, i + XMSS_AGGREGATE_MAX_CHILDREN);
      // The single attestations ride with the first group
      next.push(
        group.length === 1 && raw.length === 0
          ? group[0]
          : await aggregateXmssSignatures(group, raw, PROOF_LOG_INV_RATE)
      );
      raw = Buffer.alloc(0);
    }
    level = next;
  }
  return aggregateXmssSignatures(level, raw, PROOF_LOG_INV_RATE);
}
