import {PointFormat, Signature} from "@chainsafe/bls/types";
import bls from "@chainsafe/bls";
import {BitArray} from "@chainsafe/ssz";
import {Slot, RootHex, allForks, isElectraAttestation} from "@lodestar/types";
import {MapDef, assert} from "@lodestar/utils";
import {IClock} from "../../util/clock.js";
import {InsertOutcome, OpPoolError, OpPoolErrorCode} from "./types.js";
import {pruneBySlot, signatureFromBytesNoCheck} from "./utils.js";

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

type AggregateFastPhase0 = {
  data: allForks.Attestation["data"];
  aggregationBits: BitArray;
  signature: Signature;
};

type AggregateFastElectra = AggregateFastPhase0 & {committeeBits: BitArray};

type AggregateFast = AggregateFastPhase0 | AggregateFastElectra;

/** Hex string of DataRoot `TODO` */
type DataRootHex = string;

type CommitteeIndex = number;

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
  private readonly aggregateByIndexByRootBySlot = new MapDef<
    Slot,
    Map<DataRootHex, Map<CommitteeIndex, AggregateFast>>
  >(() => new Map<DataRootHex, Map<CommitteeIndex, AggregateFast>>());
  private lowestPermissibleSlot = 0;

  constructor(
    private readonly clock: IClock,
    private readonly cutOffSecFromSlot: number,
    private readonly preaggregateSlotDistance = 0
  ) {}

  /** Returns current count of pre-aggregated attestations with unique data */
  getAttestationCount(): number {
    let attestationCount = 0;
    for (const attestationByRoot of this.aggregateByIndexByRootBySlot.values()) {
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
   * and no error is returned. Also if it's at clock slot but come to the pool later than 2/3
   * of slot time, it's dropped too since it's not helpful for the validator anymore
   *
   * Expects the attestation to be fully validated:
   * - Valid signature
   * - Consistent bitlength
   * - Valid committeeIndex
   * - Valid data
   */
  add(committeeIndex: CommitteeIndex, attestation: allForks.Attestation, attDataRootHex: RootHex): InsertOutcome {
    const slot = attestation.data.slot;
    const lowestPermissibleSlot = this.lowestPermissibleSlot;

    // Reject any attestations that are too old.
    if (slot < lowestPermissibleSlot) {
      return InsertOutcome.Old;
    }

    // Reject attestations in the current slot but come to this pool very late
    if (this.clock.secFromSlot(slot) > this.cutOffSecFromSlot) {
      return InsertOutcome.Late;
    }

    // Limit object per slot
    const aggregateByRoot = this.aggregateByIndexByRootBySlot.getOrDefault(slot);
    if (aggregateByRoot.size >= MAX_ATTESTATIONS_PER_SLOT) {
      throw new OpPoolError({code: OpPoolErrorCode.REACHED_MAX_PER_SLOT});
    }

    // this should not happen because attestation should be validated before reaching this
    assert.notNull(committeeIndex, "Committee index should not be null in attestation pool");

    // Pre-aggregate the contribution with existing items
    let aggregateByIndex = aggregateByRoot.get(attDataRootHex);
    if (aggregateByIndex === undefined) {
      aggregateByIndex = new Map<CommitteeIndex, AggregateFast>();
      aggregateByRoot.set(attDataRootHex, aggregateByIndex);
    }
    const aggregate = aggregateByIndex.get(committeeIndex);
    if (aggregate) {
      // Aggregate mutating
      return aggregateAttestationInto(aggregate, attestation);
    } else {
      // Create new aggregate
      aggregateByIndex.set(committeeIndex, attestationToAggregate(attestation));
      return InsertOutcome.NewData;
    }
  }

  /**
   * For validator API to get an aggregate
   */
  getAggregate(slot: Slot, committeeIndex: CommitteeIndex, dataRootHex: RootHex): allForks.Attestation | null {
    const aggregate = this.aggregateByIndexByRootBySlot.get(slot)?.get(dataRootHex)?.get(committeeIndex);
    if (!aggregate) {
      // TODO: Add metric for missing aggregates
      return null;
    }

    return fastToAttestation(aggregate);
  }

  /**
   * Removes any attestations with a slot lower than `current_slot - preaggregateSlotDistance`.
   * By default, not interested in attestations in old slots, we only preaggregate attestations for the current slot.
   */
  prune(clockSlot: Slot): void {
    pruneBySlot(this.aggregateByIndexByRootBySlot, clockSlot, SLOTS_RETAINED);
    // by default preaggregateSlotDistance is 0, i.e only accept attestations in the same clock slot.
    this.lowestPermissibleSlot = Math.max(clockSlot - this.preaggregateSlotDistance, 0);
  }

  /**
   * Get all attestations optionally filtered by `attestation.data.slot`
   * @param bySlot slot to filter, `bySlot === attestation.data.slot`
   */
  getAll(bySlot?: Slot): allForks.Attestation[] {
    const attestations: allForks.Attestation[] = [];

    const aggregateByRoots =
      bySlot === undefined
        ? Array.from(this.aggregateByIndexByRootBySlot.values())
        : [this.aggregateByIndexByRootBySlot.get(bySlot)];

    for (const aggregateByRoot of aggregateByRoots) {
      if (aggregateByRoot) {
        for (const aggFastByIndex of aggregateByRoot.values()) {
          for (const aggFast of aggFastByIndex.values()) {
            attestations.push(fastToAttestation(aggFast));
          }
        }
      }
    }

    return attestations;
  }
}

// - Retrieve agg attestations by slot and data root
// - Insert attestations coming from gossip and API

/**
 * Aggregate a new attestation into `aggregate` mutating it
 */
function aggregateAttestationInto(aggregate: AggregateFast, attestation: allForks.Attestation): InsertOutcome {
  const bitIndex = attestation.aggregationBits.getSingleTrueBit();

  // Should never happen, attestations are verified against this exact condition before
  assert.notNull(bitIndex, "Invalid attestation in pool, not exactly one bit set");

  if (aggregate.aggregationBits.get(bitIndex) === true) {
    return InsertOutcome.AlreadyKnown;
  }

  aggregate.aggregationBits.set(bitIndex, true);
  aggregate.signature = bls.Signature.aggregate([
    aggregate.signature,
    signatureFromBytesNoCheck(attestation.signature),
  ]);
  return InsertOutcome.Aggregated;
}

/**
 * Format `contribution` into an efficient `aggregate` to add more contributions in with aggregateContributionInto()
 */
function attestationToAggregate(attestation: allForks.Attestation): AggregateFast {
  if (isElectraAttestation(attestation)) {
    return {
      data: attestation.data,
      // clone because it will be mutated
      aggregationBits: attestation.aggregationBits.clone(),
      committeeBits: attestation.committeeBits,
      signature: signatureFromBytesNoCheck(attestation.signature),
    };
  }
  return {
    data: attestation.data,
    // clone because it will be mutated
    aggregationBits: attestation.aggregationBits.clone(),
    signature: signatureFromBytesNoCheck(attestation.signature),
  };
}

/**
 * Unwrap AggregateFast to phase0.Attestation
 */
function fastToAttestation(aggFast: AggregateFast): allForks.Attestation {
  return {...aggFast, signature: aggFast.signature.toBytes(PointFormat.compressed)};
}
