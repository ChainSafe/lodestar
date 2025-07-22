import {Signature, aggregateSignatures} from "@chainsafe/blst";
import {BitArray} from "@chainsafe/ssz";
import {ChainForkConfig} from "@lodestar/config";
import {ForkPostElectra, MAX_COMMITTEES_PER_SLOT, SLOTS_PER_EPOCH} from "@lodestar/params";
import {EffectiveBalanceIncrements, computeEpochAtSlot} from "@lodestar/state-transition";
import {Attestation, RootHex, SingleAttestation, Slot, phase0} from "@lodestar/types";
import {MapDef} from "@lodestar/utils";
import {Metrics} from "../../metrics/metrics.js";
import {
  AttestationNonParticipant,
  AttestationsConsolidation,
  GetNotSeenValidatorsFn,
  ValidateAttestationDataFn,
} from "./aggregatedAttestationPool.js";
import {InsertOutcome} from "./types.js";
import {pruneBySlot, signatureFromBytesNoCheck} from "./utils.js";

/**
 * The number of slots storing SingleAttestation to be included in producing blocks.
 * The beacon node has to subscribe to 2 random (long-lived) subnets plus short-lived subnets for aggregation duties, in avarage it's usually less than 3 per slot.
 * Given a network of 2M active validators, total number of SingleAttestation per slot is up to 2M / 32 / 64 * 3 = 3k
 * Each SingleAttestation includes:
 * - CommitteeIndex: 8 bytes
 * - ValidatorIndex: 8 bytes
 * - AttestationData: this is shared via SeenAttestationDatas so we don't count
 * - Signature: 96 bytes, but NodeJS has some overhead so could be up to 300 bytes
 *
 * So given 3k SingleAttestations per slot, it could cause up to 3k * 316 bytes = 948kB, which is < 1MB per slot.
 * It should not affect beacon node's performance if we store 32MB of SingleAttestation in memory.
 * TODO: only store SingleAttestations when we have proposer duty once proposerLookAhead is implemented in fulu.
 * TODO: monitor on mainnet to see if we need to adject this value
 */
const SLOTS_RETAINED = SLOTS_PER_EPOCH;

/** Hex string of DataRoot `TODO` */
type DataRootHex = string;

// TODO: dedup, same for below types
type CommitteeIndex = number;

type CommitteeValidatorIndex = number;

type CommitteeInfo = {
  committeeSize: number;
  attestations: Map<CommitteeValidatorIndex, SingleAttestation<ForkPostElectra>>;
};

/**
 * A pool of `SingleAttestation` that is specially designed to block production.
 *
 * The pool has a capacity for `SLOTS_RETAINED` slots, when a new `attestation.data.slot` is
 * provided, the oldest slot is dropped and replaced with the new slot. The pool can also be
 * pruned by supplying a `current_slot`; all existing attestations with a slot lower than
 * `current_slot - SLOTS_RETAINED` will be removed and any future attestation with a slot lower
 * than that will also be refused. Pruning is done automatically based upon the attestations it
 * receives and it can be triggered manually.
 *
 */
export class SingleAttestationPool {
  /**
   * This is used to store attestations for block production
   *
   * The structure is:
   * - slot -> dataRootHex -> committeeIndex -> CommitteeInfo
   */
  private readonly committeeByIndexByRootBySlot = new MapDef<
    Slot,
    Map<DataRootHex, Map<CommitteeIndex, CommitteeInfo>>
  >(() => new Map<DataRootHex, Map<CommitteeIndex, CommitteeInfo>>());

  private lowestPermissibleSlot = 0;

  constructor(
    private readonly config: ChainForkConfig,
    private readonly metrics: Metrics | null = null
  ) {}

  /** Returns current count of SingleAttestations */
  getAttestationCount(): number {
    let attestationCount = 0;
    for (const committeeByIndexByRoot of this.committeeByIndexByRootBySlot.values()) {
      for (const committeeByIndex of committeeByIndexByRoot.values()) {
        for (const committee of committeeByIndex.values()) {
          attestationCount += committee.attestations.size;
        }
      }
    }
    return attestationCount;
  }

  /**
   * Accepts an `VerifiedUnaggregatedAttestation` and attempts to apply it to the "naive
   * aggregation pool".
   *
   * The naive aggregation pool is used by local validators to produce
   * `SignedAggregateAndProof` and also for block production.
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
  add(
    committeeIndex: CommitteeIndex,
    attestation: SingleAttestation<ForkPostElectra>,
    attDataRootHex: RootHex,
    committeeValidatorIndex: CommitteeValidatorIndex,
    committeeSize: number,
  ): InsertOutcome {
    const slot = attestation.data.slot;
    const lowestPermissibleSlot = this.lowestPermissibleSlot;

    // Reject any attestations that are too old.
    if (slot < lowestPermissibleSlot) {
      return InsertOutcome.Old;
    }

    const committeeByIndexByRoot = this.committeeByIndexByRootBySlot.getOrDefault(slot);

    let committeeByIndex = committeeByIndexByRoot.get(attDataRootHex);
    if (committeeByIndex === undefined) {
      committeeByIndex = new Map<CommitteeIndex, CommitteeInfo>();
      committeeByIndexByRoot.set(attDataRootHex, committeeByIndex);
    }
    let committeeInfo = committeeByIndex.get(committeeIndex);
    if (committeeInfo == null) {
      committeeInfo = {
        committeeSize,
        attestations: new Map<CommitteeValidatorIndex, SingleAttestation<ForkPostElectra>>(),
      };
    }

    // this pool assumes consumer checked duplicate attestation per epoch checked
    committeeInfo.attestations.set(committeeValidatorIndex, attestation);
    return InsertOutcome.NewData;
  }

  /**
   * Get all slots storing SingleAttestations in the pool.
   */
  getStoredSlots(): Set<Slot> {
    return new Set(this.committeeByIndexByRootBySlot.keys());
  }

  /**
   * Search for SingleAttestations of not seen committee members for a specific slot.
   * Before reaching this pool, we searched for aggregated attestations in AggregatedAttestationPool.
   */
  getAttestationsForBlockElectraBySlot(
    slot: Slot,
    stateSlot: Slot,
    notSeenCommitteeMembersByIndex: Map<CommitteeIndex, Set<CommitteeValidatorIndex> | null>,
    effectiveBalanceIncrements: EffectiveBalanceIncrements,
    notSeenValidatorsFn: GetNotSeenValidatorsFn,
    validateAttDataFn: ValidateAttestationDataFn
  ): AttestationsConsolidation[] {
    const committeeByIndexByRoot = this.committeeByIndexByRootBySlot.get(slot);
    if (committeeByIndexByRoot == null || committeeByIndexByRoot.size === 0) {
      // by default, a node has to subscribe to at least 2 random subnets and we loop through stored slots only
      // so throw error instead of returning empty here
      throw Error(`No attestation for slot ${slot} in attestation pool`);
    }

    const inclusionDistance = stateSlot - slot;
    const epoch = computeEpochAtSlot(slot);
    const result: AttestationsConsolidation[] = [];
    const packedAttestationsMetrics = this.metrics?.opPool.attestationPool.packedAttestations;

    // CommitteeIndex    0           1            2    ...   Consolidation (sameAttDataCons)
    // Attestations    att00  ---   att10  ---  att20  ---   0 (att 00 10 20)
    for (const committeeByCommitteeIndex of committeeByIndexByRoot.values()) {
      // same attestation data root, different committeeIndex
      if (committeeByCommitteeIndex.size === 0) {
        // it's a bug if there is no committee for a specific data root of slot
        packedAttestationsMetrics?.emptyCommittee.inc({inclusionDistance});
        continue;
      }

      const firstCommittee = Array.from(committeeByCommitteeIndex.values())[0];
      if (firstCommittee.attestations.size === 0) {
        // it's a bug if there is no SingleAttestation for the first committee
        packedAttestationsMetrics?.emptyAttestation.inc({inclusionDistance});
        continue;
      }

      const firstAttestation = Array.from(firstCommittee.attestations.values())[0];
      const attestationData = firstAttestation.data;

      const invalidAttDataReason = validateAttDataFn(attestationData);
      // null means valid
      if (invalidAttDataReason) {
        packedAttestationsMetrics?.invalidAttestationData.inc({
          reason: invalidAttDataReason,
        });
        continue;
      }

      // in AggregatedAttestationPool, sameAttDataCons could be up to MAX_ATTESTATIONS_PER_GROUP_ELECTRA because a matching group returns multiple aggregated attestations
      // here with the same attestation data, we aggregate attestations of the same committee, then consolidate cross-committee AggregateAttestations to a single AttestationsConsolidation
      const sameAttDataCon: AttestationsConsolidation = {
        byCommittee: new Map(),
        attData: attestationData,
        totalNewSeenEffectiveBalance: 0,
        newSeenAttesters: 0,
        notSeenAttesters: 0,
        totalAttesters: 0,
      };
      for (const [committeeIndex, committeeInfo] of committeeByCommitteeIndex.entries()) {
        let notSeenMembers = notSeenCommitteeMembersByIndex.get(committeeIndex);
        // in AggregatedAttestationPool we may not populate value for some committees due to its data, query from state just in case
        if (notSeenMembers === undefined) {
          notSeenMembers = notSeenValidatorsFn(epoch, slot, committeeIndex);
        }

        // null means all seen
        if (notSeenMembers === null || notSeenMembers.size === 0) {
          packedAttestationsMetrics?.seenCommittees.inc({inclusionDistance});
          continue;
        }

        const committeeSize = committeeInfo.committeeSize;
        const attestationsByCommitteeValidatorIndex = committeeInfo.attestations;

        const sameComitteeAttestations = new Map<CommitteeValidatorIndex, SingleAttestation>();
        let newSeenEffectiveBalance = 0;
        let newSeenAttesters = 0;
        let notSeenAttesters = notSeenMembers.size;
        for (const notSeenCommitteeValidatorIndex of notSeenMembers) {
          const attestation = attestationsByCommitteeValidatorIndex.get(notSeenCommitteeValidatorIndex);
          if (attestation == null) {
            // we don't have this missing SingleAttestation
            continue;
          }
          newSeenEffectiveBalance += effectiveBalanceIncrements[attestation.attesterIndex];
          newSeenAttesters++;
          notSeenAttesters--;
          sameComitteeAttestations.set(notSeenCommitteeValidatorIndex, attestation);
          // no need to search for the same notSeenCommitteeValidatorIndex in the next loop of attestation data root
          notSeenMembers.delete(notSeenCommitteeValidatorIndex);
        }

        if (sameComitteeAttestations.size === 0) {
          // no missing SingleAttestations for this committeeIndex, expect this to happen a lot of times so not sure if we should track metrics here
          continue;
        }

        const aggregatedAttestation = aggregateAttestations(sameComitteeAttestations, committeeIndex, committeeSize);
        const attestationNonParticipation: AttestationNonParticipant = {
          attestation: aggregatedAttestation,
          newSeenEffectiveBalance: 0,
          newSeenAttesters,
          notSeenCommitteeMembers: notSeenMembers,
        };

        sameAttDataCon.byCommittee.set(committeeIndex, attestationNonParticipation);
        sameAttDataCon.totalNewSeenEffectiveBalance += attestationNonParticipation.newSeenEffectiveBalance;
        sameAttDataCon.newSeenAttesters += attestationNonParticipation.newSeenAttesters;
        sameAttDataCon.notSeenAttesters += attestationNonParticipation.notSeenCommitteeMembers.size;
        sameAttDataCon.totalAttesters += committeeSize;
      } // finish looping through all committee indices of the same attestation data

      if (sameAttDataCon.byCommittee.size > 0 && sameAttDataCon.newSeenAttesters > 0) {
        // we have at least one committee with new seen attesters
        result.push(sameAttDataCon);
      }
    } // finish looping through all attestation data roots of the same slot

    packedAttestationsMetrics?.returnedAttestations.set({inclusionDistance}, result.length);

    // we bound returned AttestationsConsolidation in the consumer for each slot, so just return as many as possible
    return result;
  }

  /**
   * Removes any attestations with a slot lower than `current_slot - preaggregateSlotDistance`.
   * By default, not interested in attestations in old slots, we only preaggregate attestations for the current slot.
   */
  prune(clockSlot: Slot): void {
    pruneBySlot(this.committeeByIndexByRootBySlot, clockSlot, SLOTS_RETAINED);
    this.lowestPermissibleSlot = clockSlot - SLOTS_RETAINED;
  }
}

/**
 * Aggregate SingleAttestation of the same committee and attestation data into an aggregated attestation.
 */
function aggregateAttestations(
  sameComitteeAttestations: Map<CommitteeValidatorIndex, SingleAttestation>,
  committeeIndex: CommitteeIndex,
  committeeSize: number
): Attestation {
  if (sameComitteeAttestations.size === 0) {
    throw new Error("Cannot aggregate empty attestations");
  }

  const aggregationBits = BitArray.fromBitLen(committeeSize);
  const signatures: Signature[] = [];
  let attestationData: phase0.AttestationData | undefined = undefined;
  for (const [committeeValidatorIndex, singleAttestation] of sameComitteeAttestations.entries()) {
    aggregationBits.set(committeeValidatorIndex, true);
    signatures.push(signatureFromBytesNoCheck(singleAttestation.signature));
    if (!attestationData) {
      // We assume all attestations have the same data
      attestationData = singleAttestation.data;
    }
  }
  const aggregatedSignature = aggregateSignatures(signatures);

  if (attestationData === undefined) {
    // should not happen because we checked the size above
    throw new Error("Cannot aggregate attestations without data");
  }

  return {
    aggregationBits,
    data: attestationData,
    signature: aggregatedSignature.toBytes(),
    committeeBits: BitArray.fromSingleBit(MAX_COMMITTEES_PER_SLOT, committeeIndex),
  };
}
