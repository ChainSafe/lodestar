import {BitArray} from "@chainsafe/ssz";
import {
  XMSS_AGGREGATE_MAX_CHILDREN,
  XMSS_SIGNED_SIZE,
  XmssAggregate,
  aggregateXmssSignatures,
} from "@lodestar/native/leanvm";
import {MAX_ATTESTATIONS_PQ, MAX_COMMITTEES_PER_SLOT, SLOTS_PER_EPOCH} from "@lodestar/params";
import {CommitteeIndex, Epoch, RootHex, Slot, phase0, pq} from "@lodestar/types";
import {MapDef} from "@lodestar/utils";
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
};

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

    const aggregate = await proveSigned(committee);
    committee.aggregates.push(aggregate);
    return {data: dataAttestations.data, aggregate};
  }

  /**
   * The attestations for a block at `blockSlot` and the proof of all their signatures.
   *
   * `isIncludable` says whether the state accepts an attestation's data: its target epoch and
   * source checkpoint.
   */
  async getAttestationsForBlock(
    blockSlot: Slot,
    isIncludable: (data: phase0.AttestationData) => boolean
  ): Promise<PqBlockAttestations> {
    const attestations: pq.Attestation[] = [];
    const children: XmssAggregate[] = [];
    const signed: Uint8Array[] = [];

    // Newest first: recent attestations earn the proposer more
    const slots = Array.from(this.byRootBySlot.keys())
      .filter((slot) => slot < blockSlot && slot + SLOTS_PER_EPOCH >= blockSlot)
      .sort((a, b) => b - a);

    for (const slot of slots) {
      for (const {data, byCommittee} of (this.byRootBySlot.get(slot) as Map<RootHex, DataAttestations>).values()) {
        if (attestations.length >= MAX_ATTESTATIONS_PQ) break;
        if (!isIncludable(data)) continue;

        // An on chain aggregate covers the committees of one attestation data, in committee order
        const committeeBits = BitArray.fromBitLen(MAX_COMMITTEES_PER_SLOT);
        const bits: boolean[] = [];
        for (const committeeIndex of Array.from(byCommittee.keys()).sort((a, b) => a - b)) {
          const committee = byCommittee.get(committeeIndex) as CommitteeAttestations;
          const best = bestAggregate(committee);
          if (best !== null && best.aggregationBits.getTrueBitIndexes().length >= committee.signed.size) {
            children.push(best.aggregate);
            bits.push(...best.aggregationBits.toBoolArray());
          } else if (committee.signed.size > 0) {
            // No aggregate reached this node, or none as large: prove the single attestations
            const committeeSigned = Array.from(committee.signed.values());
            signed.push(...committeeSigned);
            bits.push(...signedBits(committee).toBoolArray());
          } else {
            continue;
          }
          committeeBits.set(committeeIndex, true);
        }
        if (bits.length === 0) continue;
        attestations.push({aggregationBits: BitArray.fromBoolArray(bits), data, committeeBits});
      }
    }

    if (attestations.length === 0) return {attestations, proof: new Uint8Array(0)};
    return {attestations, proof: (await merge(children, signed)).proof};
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

function signedBits(committee: CommitteeAttestations): BitArray {
  const bits = BitArray.fromBitLen(committee.committeeSize);
  for (const position of committee.signed.keys()) bits.set(position, true);
  return bits;
}

async function proveSigned(committee: CommitteeAttestations): Promise<PqAggregate> {
  const aggregationBits = signedBits(committee);
  const aggregate = await aggregateXmssSignatures(
    [],
    Buffer.concat(Array.from(committee.signed.values())),
    PROOF_LOG_INV_RATE
  );
  return {aggregationBits, aggregate};
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
