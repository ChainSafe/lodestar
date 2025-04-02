import {Signature, aggregateSignatures} from "@chainsafe/blst";
import {BitArray} from "@chainsafe/ssz";
import {ChainForkConfig} from "@lodestar/config";
import {EpochDifference, IForkChoice} from "@lodestar/fork-choice";
import {
  ForkName,
  ForkSeq,
  MAX_ATTESTATIONS,
  MAX_ATTESTATIONS_ELECTRA,
  MAX_COMMITTEES_PER_SLOT,
  MIN_ATTESTATION_INCLUSION_DELAY,
  SLOTS_PER_EPOCH,
  isForkPostDeneb,
  isForkPostElectra,
} from "@lodestar/params";
import {
  CachedBeaconStateAllForks,
  CachedBeaconStateAltair,
  CachedBeaconStatePhase0,
  EffectiveBalanceIncrements,
  computeEpochAtSlot,
  computeSlotsSinceEpochStart,
  computeStartSlotAtEpoch,
  getBlockRootAtSlot,
} from "@lodestar/state-transition";
import {
  Attestation,
  Epoch,
  RootHex,
  Slot,
  ValidatorIndex,
  electra,
  isElectraAttestation,
  phase0,
  ssz,
} from "@lodestar/types";
import {assert, MapDef, toRootHex} from "@lodestar/utils";
import {Metrics} from "../../metrics/metrics.js";
import {IntersectResult, intersectUint8Arrays} from "../../util/bitArray.js";
import {InsertOutcome} from "./types.js";
import {pruneBySlot, signatureFromBytesNoCheck} from "./utils.js";

type DataRootHex = string;

type CommitteeIndex = number;

// for pre-electra
type AttestationWithScore = {attestation: Attestation; score: number};
/**
 * for electra, this is to consolidate aggregated attestations of the same attestation data into a single attestation to be included in block
 * note that this is local definition in this file and it's NOT validator consolidation
 */
export type AttestationsConsolidation = {
  byCommittee: Map<CommitteeIndex, AttestationNonParticipant>;
  attData: phase0.AttestationData;
  totalEffectiveBalance: number;
  notSeenAttesters: number;
  committeeSize: number;
};

/**
 * This function returns not seen participation for a given epoch and slot and committe index.
 * Return null if all validators are seen or no info to check.
 */
type GetNotSeenValidatorsFn = (epoch: Epoch, slot: Slot, committeeIndex: number) => Set<number> | null;

type ValidateAttestationDataFn = (attData: phase0.AttestationData) => boolean;

/**
 * Limit the max attestations with the same AttestationData.
 * Processing cost increases with each new attestation. This number is not backed by data.
 * After merging AggregatedAttestationPool, gather numbers from a real network and investigate
 * how does participation looks like in attestations.
 */
const MAX_RETAINED_ATTESTATIONS_PER_GROUP = 4;

/**
 * This is the same to MAX_RETAINED_ATTESTATIONS_PER_GROUP but for electra
 * As monitored in hoodi, max attestations per group could be up to > 10. But in electra we can
 * consolidate attestations across committees, so we can just pick up to 8 attestations per group.
 * Also the MatchingDataAttestationGroup.getAttestationsForBlock() is improved not to have to scan each
 * committee member for previous slot.
 */
const MAX_RETAINED_ATTESTATIONS_PER_GROUP_ELECTRA = 8;

/**
 * Pre-electra, each slot has 64 committees, and each block has 128 attestations max so in average
 * we get 2 attestation per groups.
 * Starting from Jan 2024, we have a performance issue getting attestations for a block. Based on the
 * fact that lot of groups will have only 1 full participation attestation, increase this number
 * a bit higher than average. This also help decrease number of slots to search for attestations.
 */
const MAX_ATTESTATIONS_PER_GROUP = 3;

/**
 * For electra, there is on chain aggregation of attestations across committees, so we can just pick up to 8
 * attestations per group, sort by scores get get first 8.
 * The new algorithm is improved to get most valuable attestation helped not to get not-useful attestations anyway.
 * The more consolidations we have per block, the less likely we have to scan all slots in the pool.
 */
const MAX_ATTESTATIONS_PER_GROUP_ELECTRA = Math.min(
  MAX_RETAINED_ATTESTATIONS_PER_GROUP_ELECTRA,
  MAX_ATTESTATIONS_ELECTRA
);

export enum ScannedSlotsTerminationReason {
  MaxConsolidationReached = "max_consolidation_reached",
  ScannedAllSlots = "scanned_all_slots",
  SlotBeforePreviousEpoch = "slot_before_previous_epoch",
}

/**
 * Maintain a pool of aggregated attestations. Attestations can be retrieved for inclusion in a block
 * or api. The returned attestations are aggregated to maximise the number of validators that can be
 * included.
 * Note that we want to remove attestations with attesters that were included in the chain.
 */
export class AggregatedAttestationPool {
  /**
   * post electra, different committees could have the same AttData and we have to consolidate attestations of the same
   * data to be included in block, so we should group by data before index
   * // TODO: make sure it does not affect performance for pre electra forks
   */
  private readonly attestationGroupByIndexByDataHexBySlot = new MapDef<
    Slot,
    Map<DataRootHex, Map<CommitteeIndex, MatchingDataAttestationGroup>>
  >(() => new Map<DataRootHex, Map<CommitteeIndex, MatchingDataAttestationGroup>>());
  private lowestPermissibleSlot = 0;

  constructor(
    private readonly config: ChainForkConfig,
    private readonly metrics: Metrics | null = null
  ) {
    metrics?.opPool.aggregatedAttestationPool.attDataPerSlot.addCollect(() => this.onScrapeMetrics(metrics));
  }

  add(
    attestation: Attestation,
    dataRootHex: RootHex,
    attestingIndicesCount: number,
    committee: Uint32Array
  ): InsertOutcome {
    const slot = attestation.data.slot;
    const lowestPermissibleSlot = this.lowestPermissibleSlot;

    // Reject any attestations that are too old.
    if (slot < lowestPermissibleSlot) {
      return InsertOutcome.Old;
    }

    const attestationGroupByIndexByDataHash = this.attestationGroupByIndexByDataHexBySlot.getOrDefault(slot);
    let attestationGroupByIndex = attestationGroupByIndexByDataHash.get(dataRootHex);
    if (!attestationGroupByIndex) {
      attestationGroupByIndex = new Map<CommitteeIndex, MatchingDataAttestationGroup>();
      attestationGroupByIndexByDataHash.set(dataRootHex, attestationGroupByIndex);
    }

    let committeeIndex: number | null;

    if (isForkPostElectra(this.config.getForkName(slot))) {
      if (!isElectraAttestation(attestation)) {
        throw Error(`Attestation should be type electra.Attestation for slot ${slot}`);
      }
      committeeIndex = attestation.committeeBits.getSingleTrueBit();
    } else {
      if (isElectraAttestation(attestation)) {
        throw Error(`Attestation should be type phase0.Attestation for slot ${slot}`);
      }
      committeeIndex = attestation.data.index;
    }
    // this should not happen because attestation should be validated before reaching this
    assert.notNull(committeeIndex, "Committee index should not be null in aggregated attestation pool");
    let attestationGroup = attestationGroupByIndex.get(committeeIndex);
    if (!attestationGroup) {
      attestationGroup = new MatchingDataAttestationGroup(this.config, committee, attestation.data);
      attestationGroupByIndex.set(committeeIndex, attestationGroup);
    }

    return attestationGroup.add({
      attestation,
      trueBitsCount: attestingIndicesCount,
    });
  }

  /** Remove attestations which are too old to be included in a block. */
  prune(clockSlot: Slot): void {
    const fork = this.config.getForkName(clockSlot);

    const slotsToRetain = isForkPostDeneb(fork)
      ? // Post deneb, attestations from current and previous epoch can be included
        computeSlotsSinceEpochStart(clockSlot, computeEpochAtSlot(clockSlot) - 1)
      : // Before deneb, only retain SLOTS_PER_EPOCH slots
        SLOTS_PER_EPOCH;

    pruneBySlot(this.attestationGroupByIndexByDataHexBySlot, clockSlot, slotsToRetain);
    this.lowestPermissibleSlot = Math.max(clockSlot - slotsToRetain, 0);
  }

  getAttestationsForBlock(fork: ForkName, forkChoice: IForkChoice, state: CachedBeaconStateAllForks): Attestation[] {
    const forkSeq = ForkSeq[fork];
    return forkSeq >= ForkSeq.electra
      ? this.getAttestationsForBlockElectra(fork, forkChoice, state)
      : this.getAttestationsForBlockPreElectra(fork, forkChoice, state);
  }

  /**
   * Get attestations to be included in a block pre-electra. Returns up to $MAX_ATTESTATIONS items
   */
  getAttestationsForBlockPreElectra(
    fork: ForkName,
    forkChoice: IForkChoice,
    state: CachedBeaconStateAllForks
  ): phase0.Attestation[] {
    const stateSlot = state.slot;
    const stateEpoch = state.epochCtx.epoch;
    const statePrevEpoch = stateEpoch - 1;

    const notSeenValidatorsFn = getNotSeenValidatorsFn(state);
    const validateAttestationDataFn = getValidateAttestationDataFn(forkChoice, state);

    const attestationsByScore: AttestationWithScore[] = [];

    const slots = Array.from(this.attestationGroupByIndexByDataHexBySlot.keys()).sort((a, b) => b - a);
    let minScore = Number.MAX_SAFE_INTEGER;
    let slotCount = 0;
    slot: for (const slot of slots) {
      slotCount++;
      const attestationGroupByIndexByDataHash = this.attestationGroupByIndexByDataHexBySlot.get(slot);
      // should not happen
      if (!attestationGroupByIndexByDataHash) {
        throw Error(`No aggregated attestation pool for slot=${slot}`);
      }

      const epoch = computeEpochAtSlot(slot);
      // validateAttestation condition: Attestation target epoch not in previous or current epoch
      if (!(epoch === stateEpoch || epoch === statePrevEpoch)) {
        continue; // Invalid attestations
      }
      // validateAttestation condition: Attestation slot not within inclusion window
      if (
        !(
          slot + MIN_ATTESTATION_INCLUSION_DELAY <= stateSlot &&
          // Post deneb, attestations are valid for current and previous epoch
          (ForkSeq[fork] >= ForkSeq.deneb || stateSlot <= slot + SLOTS_PER_EPOCH)
        )
      ) {
        continue; // Invalid attestations
      }

      const slotDelta = stateSlot - slot;
      for (const attestationGroupByIndex of attestationGroupByIndexByDataHash.values()) {
        for (const [committeeIndex, attestationGroup] of attestationGroupByIndex.entries()) {
          const notSeenAttestingIndices = notSeenValidatorsFn(epoch, slot, committeeIndex);
          if (notSeenAttestingIndices === null || notSeenAttestingIndices.size === 0) {
            continue;
          }

          if (
            slotCount > 2 &&
            attestationsByScore.length >= MAX_ATTESTATIONS &&
            notSeenAttestingIndices.size / slotDelta < minScore
          ) {
            // after 2 slots, there are a good chance that we have 2 * MAX_ATTESTATIONS attestations and break the for loop early
            // if not, we may have to scan all slots in the pool
            // if we have enough attestations and the max possible score is lower than scores of `attestationsByScore`, we should skip
            // otherwise it takes time to check attestation, add it and remove it later after the sort by score
            continue;
          }

          if (!validateAttestationDataFn(attestationGroup.data)) {
            continue;
          }

          // TODO: Is it necessary to validateAttestation for:
          // - Attestation committee index not within current committee count
          // - Attestation aggregation bits length does not match committee length
          //
          // These properties should not change after being validate in gossip
          // IF they have to be validated, do it only with one attestation per group since same data
          // The committeeCountPerSlot can be precomputed once per slot
          for (const {attestation, notSeenEffectiveBalance} of attestationGroup.getAttestationsForBlock(
            fork,
            state.epochCtx.effectiveBalanceIncrements,
            notSeenAttestingIndices,
            MAX_ATTESTATIONS_PER_GROUP
          )) {
            const score = notSeenEffectiveBalance / slotDelta;
            if (score < minScore) {
              minScore = score;
            }
            attestationsByScore.push({
              attestation,
              score,
            });
          }

          // Stop accumulating attestations there are enough that may have good scoring
          if (attestationsByScore.length >= MAX_ATTESTATIONS * 2) {
            break slot;
          }
        }
      }
    }

    const sortedAttestationsByScore = attestationsByScore.sort((a, b) => b.score - a.score);
    const attestationsForBlock: phase0.Attestation[] = [];
    for (const [i, attestationWithScore] of sortedAttestationsByScore.entries()) {
      if (i >= MAX_ATTESTATIONS) {
        break;
      }
      // attestations could be modified in this op pool, so we need to clone for block
      attestationsForBlock.push(ssz.phase0.Attestation.clone(attestationWithScore.attestation));
    }
    return attestationsForBlock;
  }

  /**
   * Get attestations to be included in an electra block. Returns up to $MAX_ATTESTATIONS_ELECTRA items
   */
  getAttestationsForBlockElectra(
    fork: ForkName,
    forkChoice: IForkChoice,
    state: CachedBeaconStateAllForks
  ): electra.Attestation[] {
    const stateSlot = state.slot;
    const stateEpoch = state.epochCtx.epoch;
    const statePrevEpoch = stateEpoch - 1;

    const notSeenValidatorsFn = getNotSeenValidatorsFn(state);
    const validateAttestationDataFn = getValidateAttestationDataFn(forkChoice, state);

    const slots = Array.from(this.attestationGroupByIndexByDataHexBySlot.keys()).sort((a, b) => b - a);
    // Track score of each `AttestationsConsolidation`
    const consolidations = new Map<AttestationsConsolidation, number>();
    let scannedSlots = 0;
    let stopReason: ScannedSlotsTerminationReason | null = null;
    slot: for (const slot of slots) {
      const attestationGroupByIndexByDataHash = this.attestationGroupByIndexByDataHexBySlot.get(slot);
      // should not happen
      if (!attestationGroupByIndexByDataHash) {
        throw Error(`No aggregated attestation pool for slot=${slot}`);
      }

      const epoch = computeEpochAtSlot(slot);
      // validateAttestation condition: Attestation target epoch not in previous or current epoch
      if (!(epoch === stateEpoch || epoch === statePrevEpoch)) {
        // we process slot in desc order, this means slot is out of current or previous epoch, we should stop
        stopReason = ScannedSlotsTerminationReason.SlotBeforePreviousEpoch;
        break; // Invalid attestations
      }

      // validateAttestation condition: Attestation slot not within inclusion window
      if (!(slot + MIN_ATTESTATION_INCLUSION_DELAY <= stateSlot)) {
        continue; // Invalid attestations
      }

      const slotDelta = stateSlot - slot;
      // CommitteeIndex    0           1            2    ...   Consolidation (sameAttDataCons)
      // Attestations    att00  ---   att10  ---  att20  ---   0 (att 00 10 20)
      //                 att01  ---     -    ---  att21  ---   1 (att 01 __ 21)
      //                   -    ---     -    ---  att22  ---   2 (att __ __ 22)
      for (const attestationGroupByIndex of attestationGroupByIndexByDataHash.values()) {
        // sameAttDataCons could be up to MAX_ATTESTATIONS_PER_GROUP_ELECTRA
        const sameAttDataCons: AttestationsConsolidation[] = [];
        const allAttestationGroups = Array.from(attestationGroupByIndex.values());
        if (allAttestationGroups.length === 0) {
          continue;
        }

        if (!validateAttestationDataFn(allAttestationGroups[0].data)) {
          continue;
        }

        for (const [committeeIndex, attestationGroup] of attestationGroupByIndex.entries()) {
          const notSeenAttestingIndices = notSeenValidatorsFn(epoch, slot, committeeIndex);
          if (notSeenAttestingIndices === null || notSeenAttestingIndices.size === 0) {
            continue;
          }

          // cannot apply this optimization like pre-electra because consolidation needs to be done across committees:
          // "after 2 slots, there are a good chance that we have 2 * MAX_ATTESTATIONS_ELECTRA attestations and break the for loop early"

          // TODO: Is it necessary to validateAttestation for:
          // - Attestation committee index not within current committee count
          // - Attestation aggregation bits length does not match committee length
          //
          // These properties should not change after being validate in gossip
          // IF they have to be validated, do it only with one attestation per group since same data
          // The committeeCountPerSlot can be precomputed once per slot
          const attestationsSameGroup = attestationGroup.getAttestationsForBlock(
            fork,
            state.epochCtx.effectiveBalanceIncrements,
            notSeenAttestingIndices,
            MAX_ATTESTATIONS_PER_GROUP_ELECTRA
          );

          for (const [i, attestationNonParticipation] of attestationsSameGroup.entries()) {
            // sameAttDataCons shares the same index for different committees so we use index `i` here
            if (sameAttDataCons[i] === undefined) {
              sameAttDataCons[i] = {
                byCommittee: new Map(),
                attData: attestationNonParticipation.attestation.data,
                totalEffectiveBalance: 0,
                notSeenAttesters: 0,
                committeeSize: attestationGroup.committee.length,
              };
            }
            sameAttDataCons[i].byCommittee.set(committeeIndex, attestationNonParticipation);
            sameAttDataCons[i].totalEffectiveBalance += attestationNonParticipation.notSeenEffectiveBalance;
            sameAttDataCons[i].notSeenAttesters += attestationNonParticipation.notSeenAttendingIndices.size;
          }
        } // all committees are processed

        // after all committees are processed, we have a list of sameAttDataCons
        for (const consolidation of sameAttDataCons) {
          const score = consolidation.totalEffectiveBalance / slotDelta;
          consolidations.set(consolidation, score);
          // Stop accumulating attestations there are enough that may have good scoring
          if (consolidations.size >= MAX_ATTESTATIONS_ELECTRA * 2) {
            stopReason = ScannedSlotsTerminationReason.MaxConsolidationReached;
            break slot;
          }
        }
      }

      // finished processing a slot
      scannedSlots++;
    }

    this.metrics?.opPool.aggregatedAttestationPool.packedAttestations.totalConsolidations.set(consolidations.size);

    const sortedConsolidationsByScore = Array.from(consolidations.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([consolidation, _]) => consolidation)
      .slice(0, MAX_ATTESTATIONS_ELECTRA);

    // on chain aggregation is expensive, only do it after all
    const packedAttestationsMetrics = this.metrics?.opPool.aggregatedAttestationPool.packedAttestations;
    const packedAttestations: electra.Attestation[] = new Array(sortedConsolidationsByScore.length);
    for (const [i, consolidation] of sortedConsolidationsByScore.entries()) {
      packedAttestations[i] = aggregateConsolidation(consolidation);

      // record metrics of packed attestations
      const committeeCount = consolidation.byCommittee.size;
      packedAttestationsMetrics?.committeeBits.set({index: i}, committeeCount);
      packedAttestationsMetrics?.committeeMembers.set({index: i}, consolidation.committeeSize * committeeCount);
      packedAttestationsMetrics?.nonParticipation.set({index: i}, consolidation.notSeenAttesters);
      packedAttestationsMetrics?.slotDelta.set({index: i}, stateSlot - packedAttestations[i].data.slot);
      packedAttestationsMetrics?.totalEffectiveBalance.set({index: i}, consolidation.totalEffectiveBalance);
    }

    if (stopReason === null) {
      stopReason = ScannedSlotsTerminationReason.ScannedAllSlots;
    }
    packedAttestationsMetrics?.scannedSlots.set({reason: stopReason}, scannedSlots);
    packedAttestationsMetrics?.totalSlots.set(slots.length);

    return packedAttestations;
  }

  /**
   * Get all attestations optionally filtered by `attestation.data.slot`
   * Note this function is not fork aware and can potentially return a mix
   * of phase0.Attestations and electra.Attestations.
   * Caller of this function is expected to filtered result if they desire
   * a homogenous array.
   * @param bySlot slot to filter, `bySlot === attestation.data.slot`
   */
  getAll(bySlot?: Slot): Attestation[] {
    let attestationGroupsArr: Map<CommitteeIndex, MatchingDataAttestationGroup>[];
    if (bySlot === undefined) {
      attestationGroupsArr = Array.from(this.attestationGroupByIndexByDataHexBySlot.values()).flatMap((byIndex) =>
        Array.from(byIndex.values())
      );
    } else {
      const attestationGroupsByIndex = this.attestationGroupByIndexByDataHexBySlot.get(bySlot);
      if (!attestationGroupsByIndex) throw Error(`No attestations for slot ${bySlot}`);
      attestationGroupsArr = Array.from(attestationGroupsByIndex.values());
    }

    const attestations: Attestation[] = [];
    for (const attestationGroups of attestationGroupsArr) {
      for (const attestationGroup of attestationGroups.values()) {
        attestations.push(...attestationGroup.getAttestations());
      }
    }
    return attestations;
  }

  private onScrapeMetrics(metrics: Metrics): void {
    const allSlots = Array.from(this.attestationGroupByIndexByDataHexBySlot.keys());
    // always record the previous slot because the current slot may not be finished yet, we may receive more attestations
    if (allSlots.length > 1) {
      // same to allSlots[allSlots.length - 2];
      const previousSlot = allSlots.at(-2);
      if (previousSlot == null) {
        // only happen right after we start the node
        return;
      }

      const groupByIndexByDataHex = this.attestationGroupByIndexByDataHexBySlot.get(previousSlot);
      if (groupByIndexByDataHex != null) {
        metrics.opPool.aggregatedAttestationPool.attDataPerSlot.set(groupByIndexByDataHex.size);

        let maxAttestations = 0;
        for (const groupByIndex of groupByIndexByDataHex.values()) {
          for (const group of groupByIndex.values()) {
            const attestationCount = group.getAttestationCount();
            maxAttestations = Math.max(maxAttestations, attestationCount);
            metrics.opPool.aggregatedAttestationPool.attestationsPerCommittee.observe(attestationCount);
          }
        }
        metrics.opPool.aggregatedAttestationPool.maxAttestationsPerCommittee.set(maxAttestations);
      }
    }
  }
}

interface AttestationWithIndex {
  attestation: Attestation;
  trueBitsCount: number;
}

type AttestationNonParticipant = {
  attestation: Attestation;
  // this was `notSeenAttesterCount` in pre-electra
  // since electra, we prioritize total effective balance over attester count
  // this is only updated and used in removeBySeenValidators function
  notSeenEffectiveBalance: number;
  notSeenAttendingIndices: Set<number>;
};

/**
 * Maintain a pool of AggregatedAttestation which all share the same AttestationData.
 * Preaggregate into smallest number of attestations.
 * When getting attestations to be included in a block, sort by number of attesters.
 * Use committee instead of aggregationBits to improve performance.
 */
export class MatchingDataAttestationGroup {
  private readonly attestations: AttestationWithIndex[] = [];

  constructor(
    private readonly config: ChainForkConfig,
    readonly committee: Uint32Array,
    readonly data: phase0.AttestationData
  ) {}

  getAttestationCount(): number {
    return this.attestations.length;
  }

  /**
   * Add an attestation.
   * Try to preaggregate to existing attestations if possible.
   * If it's a subset of an existing attestations, it's not neccesrary to add to our pool.
   * If it's a superset of an existing attestation, remove the existing attestation and add new.
   */
  add(attestation: AttestationWithIndex): InsertOutcome {
    const newBits = attestation.attestation.aggregationBits;

    const indicesToRemove = [];

    for (const [i, prevAttestation] of this.attestations.entries()) {
      const prevBits = prevAttestation.attestation.aggregationBits;

      switch (intersectUint8Arrays(newBits.uint8Array, prevBits.uint8Array)) {
        case IntersectResult.Subset:
        case IntersectResult.Equal:
          // this new attestation is actually a subset of an existing one, don't want to add it
          return InsertOutcome.AlreadyKnown;

        case IntersectResult.Exclusive:
          // no intersection
          aggregateInto(prevAttestation, attestation);
          return InsertOutcome.Aggregated;

        case IntersectResult.Superset:
          // newBits superset of prevBits
          // this new attestation is superset of an existing one, remove existing one
          indicesToRemove.push(i);
      }
    }

    // Added new data
    for (const index of indicesToRemove.reverse()) {
      // TODO: .splice performance warning
      this.attestations.splice(index, 1);
    }

    this.attestations.push(attestation);

    const maxRetained = isForkPostElectra(this.config.getForkName(this.data.slot))
      ? MAX_RETAINED_ATTESTATIONS_PER_GROUP_ELECTRA
      : MAX_RETAINED_ATTESTATIONS_PER_GROUP;

    // Remove the attestations with less participation
    if (this.attestations.length > maxRetained) {
      // TODO: for electra, ideally we should sort by effective balance
      this.attestations.sort((a, b) => b.trueBitsCount - a.trueBitsCount);
      this.attestations.splice(maxRetained, this.attestations.length - maxRetained);
    }

    return InsertOutcome.NewData;
  }

  /**
   * Get AttestationNonParticipant for this groups of same attestation data.
   * @param notSeenCommitteeMembers not seen attestting indices, i.e. indices in the same committee
   * @returns an array of AttestationNonParticipant
   */
  getAttestationsForBlock(
    fork: ForkName,
    effectiveBalanceIncrements: EffectiveBalanceIncrements,
    notSeenAttestingIndices: Set<number>,
    maxAttestation: number
  ): AttestationNonParticipant[] {
    const attestations: AttestationNonParticipant[] = [];
    for (let i = 0; i < maxAttestation; i++) {
      const mostValuableAttestation = this.getMostValuableAttestation(
        fork,
        effectiveBalanceIncrements,
        notSeenAttestingIndices,
        new Set(attestations.map((a) => a.attestation))
      );

      if (mostValuableAttestation === null) {
        // stop looking for attestation because all attesters are seen or no attestation has missing attesters
        break;
      }

      attestations.push(mostValuableAttestation);
      // this will narrow down the notSeenAttestingIndices for the next iteration
      notSeenAttestingIndices = mostValuableAttestation.notSeenAttendingIndices;
    }

    return attestations;
  }

  /**
   * Most valuable attestation is attestation has the most effective balance of not seen validators.
   */
  getMostValuableAttestation(
    fork: ForkName,
    effectiveBalanceIncrements: EffectiveBalanceIncrements,
    notSeenAttestingIndices: Set<number>,
    excluded: Set<Attestation>
  ): AttestationNonParticipant | null {
    if (notSeenAttestingIndices.size === 0) {
      // no more attesters to consider
      return null;
    }

    const isPostElectra = isForkPostElectra(fork);

    let maxNotSeenEffectiveBalance = 0;
    let mostValuableAttestation: AttestationNonParticipant | null = null;
    for (const {attestation} of this.attestations) {
      if (
        (isPostElectra && !isElectraAttestation(attestation)) ||
        (!isPostElectra && isElectraAttestation(attestation))
      ) {
        continue;
      }

      if (excluded.has(attestation)) {
        continue;
      }

      const notSeen = new Set<number>();

      // from electra, we prioritize total effective balance over attester count
      let notSeenEffectiveBalance = 0;
      const {aggregationBits} = attestation;
      for (const notSeenIndex of notSeenAttestingIndices) {
        if (aggregationBits.get(notSeenIndex)) {
          notSeenEffectiveBalance += effectiveBalanceIncrements[this.committee[notSeenIndex]];
        } else {
          notSeen.add(notSeenIndex);
        }
      }

      if (notSeenEffectiveBalance > maxNotSeenEffectiveBalance) {
        maxNotSeenEffectiveBalance = notSeenEffectiveBalance;
        mostValuableAttestation = {attestation, notSeenEffectiveBalance, notSeenAttendingIndices: notSeen};
      }
    }

    return mostValuableAttestation;
  }

  /** Get attestations for API. */
  getAttestations(): Attestation[] {
    return this.attestations.map((attestation) => attestation.attestation);
  }
}

export function aggregateInto(attestation1: AttestationWithIndex, attestation2: AttestationWithIndex): void {
  // Merge bits of attestation2 into attestation1
  attestation1.attestation.aggregationBits.mergeOrWith(attestation2.attestation.aggregationBits);

  const signature1 = signatureFromBytesNoCheck(attestation1.attestation.signature);
  const signature2 = signatureFromBytesNoCheck(attestation2.attestation.signature);
  attestation1.attestation.signature = aggregateSignatures([signature1, signature2]).toBytes();
}

/**
 * Electra and after: Block proposer consolidates attestations with the same
 * attestation data from different committee into a single attestation
 * https://github.com/ethereum/consensus-specs/blob/aba6345776aa876dad368cab27fbbb23fae20455/specs/_features/eip7549/validator.md?plain=1#L39
 */
export function aggregateConsolidation({byCommittee, attData}: AttestationsConsolidation): electra.Attestation {
  const committeeBits = BitArray.fromBitLen(MAX_COMMITTEES_PER_SLOT);
  // TODO: can we improve this?
  let aggregationBits: boolean[] = [];
  const signatures: Signature[] = [];
  const sortedCommittees = Array.from(byCommittee.keys()).sort((a, b) => a - b);
  for (const committeeIndex of sortedCommittees) {
    const attestationNonParticipation = byCommittee.get(committeeIndex);
    if (attestationNonParticipation !== undefined) {
      const {attestation} = attestationNonParticipation;
      committeeBits.set(committeeIndex, true);
      aggregationBits = [...aggregationBits, ...attestation.aggregationBits.toBoolArray()];
      signatures.push(signatureFromBytesNoCheck(attestation.signature));
    }
  }
  return {
    aggregationBits: BitArray.fromBoolArray(aggregationBits),
    data: attData,
    committeeBits,
    signature: aggregateSignatures(signatures).toBytes(),
  };
}

/**
 * Pre-compute participation from a CachedBeaconStateAllForks, for use to check if an attestation's committee
 * has already attested or not.
 */
export function getNotSeenValidatorsFn(state: CachedBeaconStateAllForks): GetNotSeenValidatorsFn {
  const stateSlot = state.slot;
  if (state.config.getForkName(stateSlot) === ForkName.phase0) {
    // Get attestations to be included in a phase0 block.
    // As we are close to altair, this is not really important, it's mainly for e2e.
    // The performance is not great due to the different BeaconState data structure to altair.
    // check for phase0 block already
    const phase0State = state as CachedBeaconStatePhase0;
    const stateEpoch = computeEpochAtSlot(stateSlot);

    const previousEpochParticipants = extractParticipationPhase0(
      phase0State.previousEpochAttestations.getAllReadonly(),
      state
    );
    const currentEpochParticipants = extractParticipationPhase0(
      phase0State.currentEpochAttestations.getAllReadonly(),
      state
    );

    return (epoch: Epoch, slot: Slot, committeeIndex: number) => {
      const participants =
        epoch === stateEpoch ? currentEpochParticipants : epoch === stateEpoch - 1 ? previousEpochParticipants : null;
      if (participants === null) {
        return null;
      }
      const committee = state.epochCtx.getBeaconCommittee(slot, committeeIndex);

      const notSeenAttestingIndices = new Set<number>();
      for (const [i, validatorIndex] of committee.entries()) {
        if (!participants.has(validatorIndex)) {
          notSeenAttestingIndices.add(i);
        }
      }
      return notSeenAttestingIndices.size === 0 ? null : notSeenAttestingIndices;
    };
  }

  // altair and future forks
  // Get attestations to be included in an altair block.
  // Attestations are sorted by inclusion distance then number of attesters.
  // Attestations should pass the validation when processing attestations in state-transition.
  // check for altair block already
  const altairState = state as CachedBeaconStateAltair;
  const previousParticipation = altairState.previousEpochParticipation.getAll();
  const currentParticipation = altairState.currentEpochParticipation.getAll();
  const stateEpoch = computeEpochAtSlot(stateSlot);
  // this function could be called multiple times with same slot + committeeIndex
  const cachedNotSeenValidators = new Map<string, Set<number>>();

  return (epoch: Epoch, slot: Slot, committeeIndex: number) => {
    const participationStatus =
      epoch === stateEpoch ? currentParticipation : epoch === stateEpoch - 1 ? previousParticipation : null;

    if (participationStatus === null) {
      return null;
    }
    const cacheKey = slot + "_" + committeeIndex;
    let notSeenAttestingIndices = cachedNotSeenValidators.get(cacheKey);
    if (notSeenAttestingIndices != null) {
      // if all validators are seen then return null, we don't need to check for any attestations of same committee again
      return notSeenAttestingIndices.size === 0 ? null : notSeenAttestingIndices;
    }

    const committee = state.epochCtx.getBeaconCommittee(slot, committeeIndex);
    notSeenAttestingIndices = new Set<number>();
    for (const [i, validatorIndex] of committee.entries()) {
      // no need to check flagIsTimelySource as if validator is not seen, it's participation status is 0
      // attestations for the previous slot are not included in the state, so we don't need to check for them
      if (slot === stateSlot - 1 || participationStatus[validatorIndex] === 0) {
        notSeenAttestingIndices.add(i);
      }
    }
    cachedNotSeenValidators.set(cacheKey, notSeenAttestingIndices);
    // if all validators are seen then return null, we don't need to check for any attestations of same committee again
    return notSeenAttestingIndices.size === 0 ? null : notSeenAttestingIndices;
  };
}

export function extractParticipationPhase0(
  attestations: phase0.PendingAttestation[],
  state: CachedBeaconStateAllForks
): Set<ValidatorIndex> {
  const {epochCtx} = state;
  const allParticipants = new Set<ValidatorIndex>();
  for (const att of attestations) {
    const aggregationBits = att.aggregationBits;
    const attData = att.data;
    const attSlot = attData.slot;
    const committeeIndex = attData.index;
    const committee = epochCtx.getBeaconCommittee(attSlot, committeeIndex);
    const participants = aggregationBits.intersectValues(committee);
    for (const participant of participants) {
      allParticipants.add(participant);
    }
  }
  return allParticipants;
}

/**
 * This returns a function to validate if an attestation data is compatible to a state,
 * it's an optimized version of isValidAttestationData().
 * Atttestation data is validated by:
 * - Validate the source checkpoint
 * - Validate shuffling using beacon block root and target epoch
 *
 * Here we always validate the source checkpoint, and cache beacon block root + target epoch
 * to avoid running the same shuffling validation multiple times.
 */
export function getValidateAttestationDataFn(
  forkChoice: IForkChoice,
  state: CachedBeaconStateAllForks
): ValidateAttestationDataFn {
  const cachedValidatedAttestationData = new Map<string, boolean>();
  const {previousJustifiedCheckpoint, currentJustifiedCheckpoint} = state;
  const stateEpoch = state.epochCtx.epoch;
  return (attData: phase0.AttestationData) => {
    const targetEpoch = attData.target.epoch;
    let justifiedCheckpoint: phase0.Checkpoint;
    // simple check first
    if (targetEpoch === stateEpoch) {
      justifiedCheckpoint = currentJustifiedCheckpoint;
    } else if (targetEpoch === stateEpoch - 1) {
      justifiedCheckpoint = previousJustifiedCheckpoint;
    } else {
      return false;
    }

    if (!ssz.phase0.Checkpoint.equals(attData.source, justifiedCheckpoint)) return false;

    // Shuffling can't have changed if we're in the first few epochs
    // Also we can't look back 2 epochs if target epoch is 1 or less
    if (stateEpoch < 2 || targetEpoch < 2) {
      return true;
    }

    // the isValidAttestationData does not depend on slot and index
    const beaconBlockRootHex = toRootHex(attData.beaconBlockRoot);
    const cacheKey = beaconBlockRootHex + targetEpoch;
    let isValid = cachedValidatedAttestationData.get(cacheKey);
    if (isValid === undefined) {
      isValid = isValidShuffling(forkChoice, state, beaconBlockRootHex, targetEpoch);
      cachedValidatedAttestationData.set(cacheKey, isValid);
    }
    return isValid;
  };
}

/**
 * A straight forward version to validate attestation data. We don't use it, but keep it here for reference.
 *   - Validate the source checkpoint
 *   - Since we validated attestation's signature in gossip validation function,
 *     we only need to validate the shuffling of attestation
 *     is compatible to this state.
 *     (see https://github.com/ChainSafe/lodestar/issues/4333)
 * @returns
 */
export function isValidAttestationData(
  forkChoice: IForkChoice,
  state: CachedBeaconStateAllForks,
  data: phase0.AttestationData
): boolean {
  const {previousJustifiedCheckpoint, currentJustifiedCheckpoint} = state;
  let justifiedCheckpoint: phase0.Checkpoint;
  const stateEpoch = state.epochCtx.epoch;
  const targetEpoch = data.target.epoch;

  if (targetEpoch === stateEpoch) {
    justifiedCheckpoint = currentJustifiedCheckpoint;
  } else if (targetEpoch === stateEpoch - 1) {
    justifiedCheckpoint = previousJustifiedCheckpoint;
  } else {
    return false;
  }

  if (!ssz.phase0.Checkpoint.equals(data.source, justifiedCheckpoint)) return false;

  // Shuffling can't have changed if we're in the first few epochs
  // Also we can't look back 2 epochs if target epoch is 1 or less
  if (stateEpoch < 2 || targetEpoch < 2) {
    return true;
  }
  const beaconBlockRootHex = toRootHex(data.beaconBlockRoot);
  return isValidShuffling(forkChoice, state, beaconBlockRootHex, targetEpoch);
}

function isValidShuffling(
  forkChoice: IForkChoice,
  state: CachedBeaconStateAllForks,
  blockRootHex: RootHex,
  targetEpoch: Epoch
): boolean {
  // Otherwise the shuffling is determined by the block at the end of the target epoch
  // minus the shuffling lookahead (usually 2). We call this the "pivot".
  const pivotSlot = computeStartSlotAtEpoch(targetEpoch - 1) - 1;
  const stateDependentRoot = toRootHex(getBlockRootAtSlot(state, pivotSlot));

  // Use fork choice's view of the block DAG to quickly evaluate whether the attestation's
  // pivot block is the same as the current state's pivot block. If it is, then the
  // attestation's shuffling is the same as the current state's.
  // To account for skipped slots, find the first block at *or before* the pivot slot.
  const beaconBlockRootHex = blockRootHex;
  const beaconBlock = forkChoice.getBlockHex(beaconBlockRootHex);
  if (!beaconBlock) {
    throw Error(`Attestation data.beaconBlockRoot ${beaconBlockRootHex} not found in forkchoice`);
  }

  let attestationDependentRoot: string;
  try {
    attestationDependentRoot = forkChoice.getDependentRoot(beaconBlock, EpochDifference.previous);
  } catch (_) {
    // getDependent root may throw error if the dependent root of attestation data is prior to finalized slot
    // ignore this attestation data in that case since we're not sure it's compatible to the state
    // see https://github.com/ChainSafe/lodestar/issues/4743
    return false;
  }
  return attestationDependentRoot === stateDependentRoot;
}
