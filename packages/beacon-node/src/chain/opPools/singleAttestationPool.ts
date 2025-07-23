import {Signature, aggregateSignatures} from "@chainsafe/blst";
import {BitArray} from "@chainsafe/ssz";
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
const MAX_SLOTS_RETAINED = SLOTS_PER_EPOCH;

/**
 * This is mainly for a node subscribing to all subnets, we don't want to spend a lot of memory for this.
 * We store at least 3 recent slots of SingleAttestations to be able to include missing attestations in the next block.
 */
const MIN_SLOTS_RETAINED = 3;

/**
 * Given an average of 3k SingleAttestations per slot for 2M active validators network, and 32 slots per epoch,
 * we can store up to 100k SingleAttestations in memory.
 * As of Jul 2025, mainnet has ~1.1M active validators so we can store up to 32 slots of SingleAttestations until it reaches 2M active validators.
 */
const MAX_ATTESTATIONS_RETAINED = 100_000;

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
 * Due to memory constraints, this pool is designed to store attestations for a limited number of slots ranging from 3 to 32
 *   - For a regular node, it is expected to store attestations of 32 recent slots
 *   - For a node subscribing to all subnets, it is expected to store attestations of 3 recent slots
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

  constructor(private readonly metrics: Metrics | null = null) {
    metrics?.opPool.singleAttestationPool.size.addCollect(() => this.onScrapeMetrics(metrics));
  }

  /**
   * Store SingleAttestations in the pool to be used for block production.
   * This pool assumes consumer checked duplicate attestation per epoch checked
   */
  add(
    committeeIndex: CommitteeIndex,
    attestation: SingleAttestation<ForkPostElectra>,
    attDataRootHex: RootHex,
    committeeValidatorIndex: CommitteeValidatorIndex,
    committeeSize: number
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
      committeeByIndex.set(committeeIndex, committeeInfo);
    }

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
    const packedAttestationsMetrics = this.metrics?.opPool.singleAttestationPool.packedAttestations;

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
        for (const notSeenCommitteeValidatorIndex of notSeenMembers) {
          const attestation = attestationsByCommitteeValidatorIndex.get(notSeenCommitteeValidatorIndex);
          if (attestation == null) {
            // we don't have this missing SingleAttestation
            continue;
          }
          newSeenEffectiveBalance += effectiveBalanceIncrements[attestation.attesterIndex];
          newSeenAttesters++;
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
          newSeenEffectiveBalance,
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
   * Removes any attestations with a slot lower than `current_slot - SLOTS_RETAINED`.
   */
  prune(clockSlot: Slot): void {
    pruneBySlot(this.committeeByIndexByRootBySlot, clockSlot, MAX_SLOTS_RETAINED);
    this.lowestPermissibleSlot = clockSlot - MAX_SLOTS_RETAINED;

    // now we have 32 slots, we want to delete slots until we have less than MAX_ATTESTATIONS_RETAINED
    const attestationCountBySlot: number[] = [];
    for (let i = 0; i < MAX_SLOTS_RETAINED; i++) {
      // i = 0 => slot = clockSlot - 31 (first value)
      // i = 31 => slot = clockSlot (last value)
      attestationCountBySlot[i] = this.getAttestationCountAtSlot(clockSlot - (MAX_SLOTS_RETAINED - i) + 1);
    }

    let i = 0;
    let total = attestationCountBySlot.reduce((sum, count) => sum + count, 0);
    while (
      total > MAX_ATTESTATIONS_RETAINED &&
      Array.from(this.committeeByIndexByRootBySlot.keys()).length > MIN_SLOTS_RETAINED
    ) {
      // i = 0 => slot = clockSlot - 31 (first value)
      // i = 28 => slot = clockSlot - 3 (last value)
      const slot = clockSlot - (MAX_SLOTS_RETAINED - i) + 1;

      // i = 0 => attestationCountIndex = 31
      // i = 28 => attestationCountIndex = 3
      const attestationCount = attestationCountBySlot[i];

      this.committeeByIndexByRootBySlot.delete(slot);
      total -= attestationCount;
      i++;
    }
  }

  private onScrapeMetrics(metrics: Metrics): void {
    const poolMetrics = metrics.opPool.singleAttestationPool;
    const allSlots = Array.from(this.committeeByIndexByRootBySlot.keys());

    // last item is current slot, we want the previous one, if available.
    const previousSlot = allSlots.length > 1 ? (allSlots.at(-2) ?? null) : null;

    // always record the previous slot because the current slot may not be finished yet, we may receive more attestations
    if (previousSlot !== null) {
      const committeeByIndexByRoot = this.committeeByIndexByRootBySlot.get(previousSlot);
      if (committeeByIndexByRoot != null) {
        poolMetrics.attDataPerSlot.set(committeeByIndexByRoot.size);

        let minAttestations = Infinity;
        let committeeCount = 0;
        for (const committeeByIndex of committeeByIndexByRoot.values()) {
          for (const committeeInfo of committeeByIndex.values()) {
            const attestationCount = committeeInfo.attestations.size;
            minAttestations = Math.min(minAttestations, attestationCount);
            committeeCount += 1;
          }
        }
        // expect some committees have so few attestations and it's not included in AggreatedAttestationPool
        // we could include these attestations for block production
        poolMetrics.minAttestationsPerCommittee.set(minAttestations);
        poolMetrics.committeesPerSlot.set(committeeCount);
      }
    }

    poolMetrics.size.set(this.getAttestationCount());
    poolMetrics.slotCount.set(this.committeeByIndexByRootBySlot.size);
  }

  /** Returns current count of SingleAttestations */
  private getAttestationCount(): number {
    let attestationCount = 0;
    for (const slot of this.committeeByIndexByRootBySlot.keys()) {
      attestationCount += this.getAttestationCountAtSlot(slot);
    }
    return attestationCount;
  }

  /**
   * Returns the count of SingleAttestations for a specific slot.
   */
  private getAttestationCountAtSlot(slot: Slot): number {
    const committeeByIndexByRoot = this.committeeByIndexByRootBySlot.get(slot);
    if (committeeByIndexByRoot == null) {
      return 0;
    }

    let attestationCount = 0;
    for (const committeeByIndex of committeeByIndexByRoot.values()) {
      for (const committee of committeeByIndex.values()) {
        attestationCount += committee.attestations.size;
      }
    }
    return attestationCount;
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
