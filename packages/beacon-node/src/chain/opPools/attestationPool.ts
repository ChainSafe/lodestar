import {phase0, Slot, Root, ssz} from "@lodestar/types";
import {PointFormat, Signature} from "@chainsafe/bls/types";
import bls from "@chainsafe/bls";
import {BitArray, toHexString} from "@chainsafe/ssz";
import {MapDef} from "@lodestar/utils";
import {InsertOutcome, OpPoolError, OpPoolErrorCode} from "./types.js";
import {pruneBySlot} from "./utils.js";

/**
 * The number of slots that will be stored in the pool.
 *
 * For example, if `SLOTS_RETAINED == 3` and the pool is pruned at slot `6`, then all attestations
 * at slots less than `4` will be dropped and any future attestation with a slot less than `4`
 * will be refused.
 */
const SLOTS_RETAINED = 3;

/**
 * The maximum number of distinct `AttestationData` that will be stored in each slot.
 *
 * This is a DoS protection measure.
 */
const MAX_ATTESTATIONS_PER_SLOT = 16_384;

type AggregateFast = {
  data: phase0.Attestation["data"];
  aggregationBits: BitArray;
  signature: Signature;
};

/** Hex string of DataRoot `TODO` */
type DataRootHex = string;

/**
 * A pool of `Attestation` that is specially designed to store "unaggregated" attestations from
 * the native aggregation scheme.
 *
 * **The `NaiveAggregationPool` does not do any signature or attestation verification. It assumes
 * that all `Attestation` objects provided are valid.**
 *
 * ## Details
 *
 * The pool sorts the `Attestation` by `attestation.data.slot`, then by `attestation.data`.
 *
 * As each unaggregated attestation is added it is aggregated with any existing `attestation` with
 * the same `AttestationData`. Considering that the pool only accepts attestations with a single
 * signature, there should only ever be a single aggregated `Attestation` for any given
 * `AttestationData`.
 *
 * The pool has a capacity for `SLOTS_RETAINED` slots, when a new `attestation.data.slot` is
 * provided, the oldest slot is dropped and replaced with the new slot. The pool can also be
 * pruned by supplying a `current_slot`; all existing attestations with a slot lower than
 * `current_slot - SLOTS_RETAINED` will be removed and any future attestation with a slot lower
 * than that will also be refused. Pruning is done automatically based upon the attestations it
 * receives and it can be triggered manually.
 */
export class AttestationPool {
  private readonly attestationByRootBySlot = new MapDef<Slot, Map<DataRootHex, AggregateFast>>(
    () => new Map<DataRootHex, AggregateFast>()
  );
  private lowestPermissibleSlot = 0;

  /** Returns current count of pre-aggregated attestations with unique data */
  getAttestationCount(): number {
    let attestationCount = 0;
    for (const attestationByRoot of this.attestationByRootBySlot.values()) {
      attestationCount += attestationByRoot.size;
    }
    return attestationCount;
  }

  /**
   * Accepts an `VerifiedUnaggregatedAttestation` and attempts to apply it to the "naive
   * aggregation pool".
   *
   * The naive aggregation pool is used by local validators to produce
   * `SignedAggregateAndProof`.
   *
   * If the attestation is too old (low slot) to be included in the pool it is simply dropped
   * and no error is returned.
   *
   * Expects the attestation to be fully validated:
   * - Valid signature
   * - Consistent bitlength
   * - Valid committeeIndex
   * - Valid data
   */
  add(attestation: phase0.Attestation): InsertOutcome {
    const slot = attestation.data.slot;
    const lowestPermissibleSlot = this.lowestPermissibleSlot;

    // Reject any attestations that are too old.
    if (slot < lowestPermissibleSlot) {
      return InsertOutcome.Old;
    }

    // Limit object per slot
    const aggregateByRoot = this.attestationByRootBySlot.getOrDefault(slot);
    if (aggregateByRoot.size >= MAX_ATTESTATIONS_PER_SLOT) {
      throw new OpPoolError({code: OpPoolErrorCode.REACHED_MAX_PER_SLOT});
    }

    const dataRoot = ssz.phase0.AttestationData.hashTreeRoot(attestation.data);
    const dataRootHex = toHexString(dataRoot);

    // Pre-aggregate the contribution with existing items
    const aggregate = aggregateByRoot.get(dataRootHex);
    if (aggregate) {
      // Aggregate mutating
      return aggregateAttestationInto(aggregate, attestation);
    } else {
      // Create new aggregate
      aggregateByRoot.set(dataRootHex, attestationToAggregate(attestation));
      return InsertOutcome.NewData;
    }
  }

  /**
   * For validator API to get an aggregate
   */
  getAggregate(slot: Slot, dataRoot: Root): phase0.Attestation {
    const dataRootHex = toHexString(dataRoot);
    const aggregate = this.attestationByRootBySlot.get(slot)?.get(dataRootHex);
    if (!aggregate) {
      // TODO: Add metric for missing aggregates
      throw Error(`No attestation for slot=${slot} dataRoot=${dataRootHex}`);
    }

    return fastToAttestation(aggregate);
  }

  /**
   * Removes any attestations with a slot lower than `current_slot` and bars any future
   * attestations with a slot lower than `current_slot - SLOTS_RETAINED`.
   */
  prune(clockSlot: Slot): void {
    pruneBySlot(this.attestationByRootBySlot, clockSlot, SLOTS_RETAINED);
    this.lowestPermissibleSlot = Math.max(clockSlot - SLOTS_RETAINED, 0);
  }

  /**
   * Get all attestations optionally filtered by `attestation.data.slot`
   * @param bySlot slot to filter, `bySlot === attestation.data.slot`
   */
  getAll(bySlot?: Slot): phase0.Attestation[] {
    const attestations: phase0.Attestation[] = [];

    const aggregateByRoots =
      bySlot === undefined
        ? Array.from(this.attestationByRootBySlot.values())
        : [this.attestationByRootBySlot.get(bySlot)];

    for (const aggregateByRoot of aggregateByRoots) {
      if (aggregateByRoot) {
        for (const aggFast of aggregateByRoot.values()) {
          attestations.push(fastToAttestation(aggFast));
        }
      }
    }

    return attestations;
  }
}

// - Retrieve agg attestations by slot and data root
// - Insert attestations coming from gossip and API

/**
 * Aggregate a new contribution into `aggregate` mutating it
 */
function aggregateAttestationInto(aggregate: AggregateFast, attestation: phase0.Attestation): InsertOutcome {
  const bitIndex = attestation.aggregationBits.getSingleTrueBit();

  // Should never happen, attestations are verified against this exact condition before
  if (bitIndex === null) {
    throw Error("Invalid attestation not exactly one bit set");
  }

  if (aggregate.aggregationBits.get(bitIndex) === true) {
    return InsertOutcome.AlreadyKnown;
  }

  aggregate.aggregationBits.set(bitIndex, true);
  aggregate.signature = bls.Signature.aggregate([
    aggregate.signature,
    bls.Signature.fromBytes(attestation.signature, undefined, true),
  ]);
  return InsertOutcome.Aggregated;
}

/**
 * Format `contribution` into an efficient `aggregate` to add more contributions in with aggregateContributionInto()
 */
function attestationToAggregate(attestation: phase0.Attestation): AggregateFast {
  return {
    data: attestation.data,
    // clone because it will be mutated
    aggregationBits: attestation.aggregationBits.clone(),
    signature: bls.Signature.fromBytes(attestation.signature, undefined, true),
  };
}

/**
 * Unwrap AggregateFast to phase0.Attestation
 */
function fastToAttestation(aggFast: AggregateFast): phase0.Attestation {
  return {
    data: aggFast.data,
    aggregationBits: aggFast.aggregationBits,
    signature: aggFast.signature.toBytes(PointFormat.compressed),
  };
}
