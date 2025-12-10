import {Signature, aggregateSignatures} from "@chainsafe/blst";
import {BitArray} from "@chainsafe/ssz";
import {ChainForkConfig} from "@lodestar/config";
import {IForkChoice} from "@lodestar/fork-choice";
import {
  ForkName,
  ForkSeq,
  MAX_ATTESTATIONS,
  MAX_ATTESTATIONS_ELECTRA,
  MAX_COMMITTEES_PER_SLOT,
  MIN_ATTESTATION_INCLUSION_DELAY,
  SLOTS_PER_EPOCH,
  TIMELY_HEAD_FLAG_INDEX,
  TIMELY_HEAD_WEIGHT,
  TIMELY_SOURCE_FLAG_INDEX,
  TIMELY_SOURCE_WEIGHT,
  TIMELY_TARGET_FLAG_INDEX,
  TIMELY_TARGET_WEIGHT,
  isForkPostDeneb,
  isForkPostElectra,
} from "@lodestar/params";
import {
  CachedBeaconStateAllForks,
  CachedBeaconStateAltair,
  CachedBeaconStateGloas,
  CachedBeaconStatePhase0,
  EffectiveBalanceIncrements,
  RootCache,
  computeEpochAtSlot,
  computeSlotsSinceEpochStart,
  computeStartSlotAtEpoch,
  getAttestationParticipationStatus,
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
import {MapDef, assert, toRootHex} from "@lodestar/utils";
import {Metrics} from "../../metrics/metrics.js";
import {IntersectResult, intersectUint8Arrays} from "../../util/bitArray.js";
import {getShufflingDependentRoot} from "../../util/dependentRoot.js";
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
  totalNewSeenEffectiveBalance: number;
  newSeenAttesters: number;
  notSeenAttesters: number;
  /** total number of attesters across all committees in this consolidation */
  totalAttesters: number;
};

/**
 * This function returns not seen participation for a given epoch and slot and committee index.
 * Return null if all validators are seen or no info to check.
 */
type GetNotSeenValidatorsFn = (epoch: Epoch, slot: Slot, committeeIndex: number) => Set<number> | null;

/**
 * Invalid attestation data reasons, this is useful to track in metrics.
 */
export enum InvalidAttestationData {
  InvalidTargetEpoch = "invalid_target_epoch",
  InvalidSourceCheckPoint = "invalid_source_checkpoint",
  BlockNotInForkChoice = "block_not_in_fork_choice",
  CannotGetShufflingDependentRoot = "cannot_get_shuffling_dependent_root",
  IncorrectDependentRoot = "incorrect_dependent_root",
}

/**
 * Validate attestation data for inclusion in a block.
 * Returns InvalidAttestationData if attestation data is invalid, null otherwise.
 */
type ValidateAttestationDataFn = (attData: phase0.AttestationData) => InvalidAttestationData | null;

/**
 * Limit the max attestations with the same AttestationData.
 * Processing cost increases with each new attestation. This number is not backed by data.
 * After merging AggregatedAttestationPool, gather numbers from a real network and investigate
 * how does participation looks like in attestations.
 */
const MAX_RETAINED_ATTESTATIONS_PER_GROUP = 4;

/**
 * This is the same to MAX_RETAINED_ATTESTATIONS_PER_GROUP but for electra.
 * As monitored in hoodi, max attestations per group could be up to > 10. But since electra we can
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
 * attestations per group, sort by scores to get first 8.
 * The new algorithm helps not to include useless attestations so we usually cannot get up to 8.
 * The more consolidations we have per block, the less likely we have to scan all slots in the pool.
 * This is max attestations returned per group, it does not make sense to have this number greater
 * than MAX_RETAINED_ATTESTATIONS_PER_GROUP_ELECTRA or MAX_ATTESTATIONS_ELECTRA.
 */
const MAX_ATTESTATIONS_PER_GROUP_ELECTRA = Math.min(
  MAX_RETAINED_ATTESTATIONS_PER_GROUP_ELECTRA,
  MAX_ATTESTATIONS_ELECTRA
);

/** Same to https://github.com/ethereum/consensus-specs/blob/v1.5.0/specs/altair/beacon-chain.md#has_flag */
const TIMELY_SOURCE = 1 << TIMELY_SOURCE_FLAG_INDEX;
const TIMELY_TARGET = 1 << TIMELY_TARGET_FLAG_INDEX;
const TIMELY_HEAD = 1 << TIMELY_HEAD_FLAG_INDEX;

export enum ScannedSlotsTerminationReason {
  MaxConsolidationReached = "max_consolidation_reached",
  ScannedAllSlots = "scanned_all_slots",
  SlotBeforePreviousEpoch = "slot_before_previous_epoch",
}

/**
 * Maintain a pool of aggregated attestations. Attestations can be retrieved for inclusion in a block
 * or api. The returned attestations are aggregated to maximize the number of validators that can be
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

      const inclusionDistance = stateSlot - slot;
      for (const attestationGroupByIndex of attestationGroupByIndexByDataHash.values()) {
        for (const [committeeIndex, attestationGroup] of attestationGroupByIndex.entries()) {
          const notSeenCommitteeMembers = notSeenValidatorsFn(epoch, slot, committeeIndex);
          if (notSeenCommitteeMembers === null || notSeenCommitteeMembers.size === 0) {
            continue;
          }

          if (
            slotCount > 2 &&
            attestationsByScore.length >= MAX_ATTESTATIONS &&
            notSeenCommitteeMembers.size / inclusionDistance < minScore
          ) {
            // after 2 slots, there are a good chance that we have 2 * MAX_ATTESTATIONS attestations and break the for loop early
            // if not, we may have to scan all slots in the pool
            // if we have enough attestations and the max possible score is lower than scores of `attestationsByScore`, we should skip
            // otherwise it takes time to check attestation, add it and remove it later after the sort by score
            continue;
          }

          if (validateAttestationDataFn(attestationGroup.data) !== null) {
            continue;
          }

          // TODO: Is it necessary to validateAttestation for:
          // - Attestation committee index not within current committee count
          // - Attestation aggregation bits length does not match committee length
          //
          // These properties should not change after being validate in gossip
          // IF they have to be validated, do it only with one attestation per group since same data
          // The committeeCountPerSlot can be precomputed once per slot
          const getAttestationsResult = attestationGroup.getAttestationsForBlock(
            fork,
            state.epochCtx.effectiveBalanceIncrements,
            notSeenCommitteeMembers,
            MAX_ATTESTATIONS_PER_GROUP
          );
          for (const {attestation, newSeenEffectiveBalance} of getAttestationsResult.result) {
            const score = newSeenEffectiveBalance / inclusionDistance;
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
    const rootCache = new RootCache(state);

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
      if (epoch < statePrevEpoch) {
        // we process slot in desc order, this means next slot is not eligible, we should stop
        stopReason = ScannedSlotsTerminationReason.SlotBeforePreviousEpoch;
        break;
      }

      // validateAttestation condition: Attestation target epoch not in previous or current epoch
      if (!(epoch === stateEpoch || epoch === statePrevEpoch)) {
        continue; // Invalid attestations
      }

      // validateAttestation condition: Attestation slot not within inclusion window
      if (!(slot + MIN_ATTESTATION_INCLUSION_DELAY <= stateSlot)) {
        // this should not happen as slot is decreased so no need to track in metric
        continue; // Invalid attestations
      }

      const inclusionDistance = stateSlot - slot;
      let returnedAttestationsPerSlot = 0;
      let totalAttestationsPerSlot = 0;
      // CommitteeIndex    0           1            2    ...   Consolidation (sameAttDataCons)
      // Attestations    att00  ---   att10  ---  att20  ---   0 (att 00 10 20)
      //                 att01  ---     -    ---  att21  ---   1 (att 01 __ 21)
      //                   -    ---     -    ---  att22  ---   2 (att __ __ 22)
      for (const attestationGroupByIndex of attestationGroupByIndexByDataHash.values()) {
        // sameAttDataCons could be up to MAX_ATTESTATIONS_PER_GROUP_ELECTRA
        const sameAttDataCons: AttestationsConsolidation[] = [];
        const allAttestationGroups = Array.from(attestationGroupByIndex.values());
        if (allAttestationGroups.length === 0) {
          this.metrics?.opPool.aggregatedAttestationPool.packedAttestations.emptyAttestationData.inc();
          continue;
        }

        const invalidAttDataReason = validateAttestationDataFn(allAttestationGroups[0].data);
        if (invalidAttDataReason !== null) {
          this.metrics?.opPool.aggregatedAttestationPool.packedAttestations.invalidAttestationData.inc({
            reason: invalidAttDataReason,
          });
          continue;
        }

        for (const [committeeIndex, attestationGroup] of attestationGroupByIndex.entries()) {
          const notSeenCommitteeMembers = notSeenValidatorsFn(epoch, slot, committeeIndex);
          if (notSeenCommitteeMembers === null || notSeenCommitteeMembers.size === 0) {
            this.metrics?.opPool.aggregatedAttestationPool.packedAttestations.seenCommittees.inc();
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
          const getAttestationGroupResult = attestationGroup.getAttestationsForBlock(
            fork,
            state.epochCtx.effectiveBalanceIncrements,
            notSeenCommitteeMembers,
            MAX_ATTESTATIONS_PER_GROUP_ELECTRA
          );
          const attestationsSameGroup = getAttestationGroupResult.result;
          returnedAttestationsPerSlot += attestationsSameGroup.length;
          totalAttestationsPerSlot += getAttestationGroupResult.totalAttestations;

          for (const [i, attestationNonParticipation] of attestationsSameGroup.entries()) {
            // sameAttDataCons shares the same index for different committees so we use index `i` here
            if (sameAttDataCons[i] === undefined) {
              sameAttDataCons[i] = {
                byCommittee: new Map(),
                attData: attestationNonParticipation.attestation.data,
                totalNewSeenEffectiveBalance: 0,
                newSeenAttesters: 0,
                notSeenAttesters: 0,
                totalAttesters: 0,
              };
            }
            const sameAttDataCon = sameAttDataCons[i];
            // committeeIndex was from a map so it should be unique, but just in case
            if (!sameAttDataCon.byCommittee.has(committeeIndex)) {
              sameAttDataCon.byCommittee.set(committeeIndex, attestationNonParticipation);
              sameAttDataCon.totalNewSeenEffectiveBalance += attestationNonParticipation.newSeenEffectiveBalance;
              sameAttDataCon.newSeenAttesters += attestationNonParticipation.newSeenAttesters;
              sameAttDataCon.notSeenAttesters += attestationNonParticipation.notSeenCommitteeMembers.size;
              sameAttDataCon.totalAttesters += attestationGroup.committee.length;
            }
          }
        } // all committees are processed

        this.metrics?.opPool.aggregatedAttestationPool.packedAttestations.returnedAttestations.set(
          {inclusionDistance},
          returnedAttestationsPerSlot
        );
        this.metrics?.opPool.aggregatedAttestationPool.packedAttestations.scannedAttestations.set(
          {inclusionDistance},
          totalAttestationsPerSlot
        );

        // after all committees are processed, we have a list of sameAttDataCons
        for (const consolidation of sameAttDataCons) {
          // Score attestations by profitability to maximize proposer reward
          const flags = getAttestationParticipationStatus(
            ForkSeq[fork],
            consolidation.attData,
            inclusionDistance,
            stateEpoch,
            rootCache,
            ForkSeq[fork] >= ForkSeq.gloas
              ? (state as CachedBeaconStateGloas).executionPayloadAvailability.toBoolArray()
              : null
          );

          const weight =
            ((flags & TIMELY_SOURCE) === TIMELY_SOURCE ? TIMELY_SOURCE_WEIGHT : 0) +
            ((flags & TIMELY_TARGET) === TIMELY_TARGET ? TIMELY_TARGET_WEIGHT : 0) +
            ((flags & TIMELY_HEAD) === TIMELY_HEAD ? TIMELY_HEAD_WEIGHT : 0);

          const score = consolidation.totalNewSeenEffectiveBalance * weight;

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
      packedAttestationsMetrics?.committeeCount.set({index: i}, consolidation.byCommittee.size);
      packedAttestationsMetrics?.totalAttesters.set({index: i}, consolidation.totalAttesters);
      packedAttestationsMetrics?.nonParticipation.set({index: i}, consolidation.notSeenAttesters);
      packedAttestationsMetrics?.inclusionDistance.set({index: i}, stateSlot - packedAttestations[i].data.slot);
      packedAttestationsMetrics?.newSeenAttesters.set({index: i}, consolidation.newSeenAttesters);
      packedAttestationsMetrics?.totalEffectiveBalance.set({index: i}, consolidation.totalNewSeenEffectiveBalance);
    }

    if (stopReason === null) {
      stopReason = ScannedSlotsTerminationReason.ScannedAllSlots;
    }
    packedAttestationsMetrics?.scannedSlots.set({reason: stopReason}, scannedSlots);
    packedAttestationsMetrics?.poolSlots.set(slots.length);

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
    const poolMetrics = metrics.opPool.aggregatedAttestationPool;
    const allSlots = Array.from(this.attestationGroupByIndexByDataHexBySlot.keys());

    // last item is current slot, we want the previous one, if available.
    const previousSlot = allSlots.length > 1 ? (allSlots.at(-2) ?? null) : null;

    let attestationCount = 0;
    let attestationDataCount = 0;

    // always record the previous slot because the current slot may not be finished yet, we may receive more attestations
    if (previousSlot !== null) {
      const groupByIndexByDataHex = this.attestationGroupByIndexByDataHexBySlot.get(previousSlot);
      if (groupByIndexByDataHex != null) {
        poolMetrics.attDataPerSlot.set(groupByIndexByDataHex.size);

        let maxAttestations = 0;
        let committeeCount = 0;
        for (const groupByIndex of groupByIndexByDataHex.values()) {
          attestationDataCount += groupByIndex.size;
          for (const group of groupByIndex.values()) {
            const attestationCountInGroup = group.getAttestationCount();
            maxAttestations = Math.max(maxAttestations, attestationCountInGroup);
            poolMetrics.attestationsPerCommittee.observe(attestationCountInGroup);
            committeeCount += 1;

            attestationCount += attestationCountInGroup;
          }
        }
        poolMetrics.maxAttestationsPerCommittee.set(maxAttestations);
        poolMetrics.committeesPerSlot.set(committeeCount);
      }
    }

    for (const [slot, attestationGroupByIndexByDataHex] of this.attestationGroupByIndexByDataHexBySlot) {
      // We have already updated attestationDataCount and attestationCount when looping over `previousSlot`
      if (slot === previousSlot) {
        continue;
      }
      for (const attestationGroupByIndex of attestationGroupByIndexByDataHex.values()) {
        attestationDataCount += attestationGroupByIndex.size;
        for (const attestationGroup of attestationGroupByIndex.values()) {
          attestationCount += attestationGroup.getAttestationCount();
        }
      }
    }

    poolMetrics.size.set(attestationCount);
    poolMetrics.uniqueData.set(attestationDataCount);
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
  // as attestation value can vary significantly between validators due to EIP-7251
  // this is only updated and used in removeBySeenValidators function
  newSeenEffectiveBalance: number;
  newSeenAttesters: number;
  notSeenCommitteeMembers: Set<number>;
};

type GetAttestationsGroupResult = {
  result: AttestationNonParticipant[];
  totalAttestations: number;
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
      // ideally we should sort by effective balance but there is no state/effectiveBalance here
      // it's rare to see > 8 attestations per group in electra anyway
      this.attestations.sort((a, b) => b.trueBitsCount - a.trueBitsCount);
      this.attestations.splice(maxRetained, this.attestations.length - maxRetained);
    }

    return InsertOutcome.NewData;
  }

  /**
   * Get AttestationNonParticipant for this groups of same attestation data.
   * @param notSeenCommitteeMembers not seen committee members, i.e. indices in the same committee (starting from 0 till (committee.size - 1))
   * @returns an array of AttestationNonParticipant
   */
  getAttestationsForBlock(
    fork: ForkName,
    effectiveBalanceIncrements: EffectiveBalanceIncrements,
    notSeenCommitteeMembers: Set<number>,
    maxAttestation: number
  ): GetAttestationsGroupResult {
    const attestations: AttestationNonParticipant[] = [];
    const excluded = new Set<Attestation>();
    for (let i = 0; i < maxAttestation; i++) {
      const mostValuableAttestation = this.getMostValuableAttestation(
        fork,
        effectiveBalanceIncrements,
        notSeenCommitteeMembers,
        excluded
      );

      if (mostValuableAttestation === null) {
        // stop looking for attestation because all attesters are seen or no attestation has missing attesters
        break;
      }

      attestations.push(mostValuableAttestation);
      excluded.add(mostValuableAttestation.attestation);
      // this will narrow down the notSeenCommitteeMembers for the next iteration
      // so usually it will not take much time, however it could take more time during
      // non-finality of the network when there is low participation, but in this case
      // we pre-aggregate aggregated attestations and bound the total attestations per group
      notSeenCommitteeMembers = mostValuableAttestation.notSeenCommitteeMembers;
    }

    return {result: attestations, totalAttestations: this.attestations.length};
  }

  /**
   * Select the attestation with the highest total effective balance of not seen validators.
   */
  private getMostValuableAttestation(
    fork: ForkName,
    effectiveBalanceIncrements: EffectiveBalanceIncrements,
    notSeenCommitteeMembers: Set<number>,
    excluded: Set<Attestation>
  ): AttestationNonParticipant | null {
    if (notSeenCommitteeMembers.size === 0) {
      // no more attesters to consider
      return null;
    }

    const isPostElectra = isForkPostElectra(fork);

    let maxNewSeenEffectiveBalance = 0;
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

      // we prioritize total effective balance over attester count
      let newSeenEffectiveBalance = 0;
      let newSeenAttesters = 0;
      const {aggregationBits} = attestation;
      for (const notSeenIndex of notSeenCommitteeMembers) {
        if (aggregationBits.get(notSeenIndex)) {
          newSeenEffectiveBalance += effectiveBalanceIncrements[this.committee[notSeenIndex]];
          newSeenAttesters++;
        } else {
          notSeen.add(notSeenIndex);
        }
      }

      if (newSeenEffectiveBalance > maxNewSeenEffectiveBalance) {
        maxNewSeenEffectiveBalance = newSeenEffectiveBalance;
        mostValuableAttestation = {
          attestation,
          newSeenEffectiveBalance,
          newSeenAttesters,
          notSeenCommitteeMembers: notSeen,
        };
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

      const notSeenCommitteeMembers = new Set<number>();
      for (const [i, validatorIndex] of committee.entries()) {
        if (!participants.has(validatorIndex)) {
          notSeenCommitteeMembers.add(i);
        }
      }
      return notSeenCommitteeMembers.size === 0 ? null : notSeenCommitteeMembers;
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
    let notSeenCommitteeMembers = cachedNotSeenValidators.get(cacheKey);
    if (notSeenCommitteeMembers != null) {
      // if all validators are seen then return null, we don't need to check for any attestations of same committee again
      return notSeenCommitteeMembers.size === 0 ? null : notSeenCommitteeMembers;
    }

    const committee = state.epochCtx.getBeaconCommittee(slot, committeeIndex);
    notSeenCommitteeMembers = new Set<number>();
    for (const [i, validatorIndex] of committee.entries()) {
      // no need to check flagIsTimelySource as if validator is not seen, it's participation status is 0
      // attestations for the previous slot are not included in the state, so we don't need to check for them
      if (slot === stateSlot - 1 || participationStatus[validatorIndex] === 0) {
        notSeenCommitteeMembers.add(i);
      }
    }
    cachedNotSeenValidators.set(cacheKey, notSeenCommitteeMembers);
    // if all validators are seen then return null, we don't need to check for any attestations of same committee again
    return notSeenCommitteeMembers.size === 0 ? null : notSeenCommitteeMembers;
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
 * This returns a function to validate if an attestation data is compatible to a state.
 *
 * Attestation data is validated by:
 * - Validate the source checkpoint
 * - Validate shuffling using beacon block root and target epoch
 *
 * Here we always validate the source checkpoint, and cache beacon block root + target epoch
 * to avoid running the same shuffling validation multiple times.
 *
 * See also: https://github.com/ChainSafe/lodestar/issues/4333
 */
export function getValidateAttestationDataFn(
  forkChoice: IForkChoice,
  state: CachedBeaconStateAllForks
): ValidateAttestationDataFn {
  const cachedValidatedAttestationData = new Map<string, InvalidAttestationData | null>();
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
      return InvalidAttestationData.InvalidTargetEpoch;
    }

    if (!ssz.phase0.Checkpoint.equals(attData.source, justifiedCheckpoint)) {
      return InvalidAttestationData.InvalidSourceCheckPoint;
    }

    // Shuffling can't have changed if we're in the first few epochs
    // Also we can't look back 2 epochs if target epoch is 1 or less
    if (stateEpoch < 2 || targetEpoch < 2) {
      // null means valid
      return null;
    }

    // valid attestation data does not depend on slot and index
    const beaconBlockRootHex = toRootHex(attData.beaconBlockRoot);
    const cacheKey = beaconBlockRootHex + targetEpoch;
    let invalidReasonOrNull = cachedValidatedAttestationData.get(cacheKey);
    if (invalidReasonOrNull === undefined) {
      invalidReasonOrNull = isValidShuffling(forkChoice, state, beaconBlockRootHex, targetEpoch);
      cachedValidatedAttestationData.set(cacheKey, invalidReasonOrNull);
    }
    return invalidReasonOrNull;
  };
}

/**
 * Validate the shuffling of an attestation data against the current state.
 * Return `null` if the shuffling is valid, otherwise return an `InvalidAttestationData` reason.
 */
function isValidShuffling(
  forkChoice: IForkChoice,
  state: CachedBeaconStateAllForks,
  blockRootHex: RootHex,
  targetEpoch: Epoch
): InvalidAttestationData | null {
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
    return InvalidAttestationData.BlockNotInForkChoice;
  }

  let attestationDependentRoot: string;
  try {
    // should not use forkChoice.getDependentRoot directly, see https://github.com/ChainSafe/lodestar/issues/7651
    // attestationDependentRoot = forkChoice.getDependentRoot(beaconBlock, EpochDifference.previous);
    attestationDependentRoot = getShufflingDependentRoot(
      forkChoice,
      targetEpoch,
      computeEpochAtSlot(beaconBlock.slot),
      beaconBlock
    );
  } catch (_) {
    // getDependent root may throw error if the dependent root of attestation data is prior to finalized slot
    // ignore this attestation data in that case since we're not sure it's compatible to the state
    // see https://github.com/ChainSafe/lodestar/issues/4743
    return InvalidAttestationData.CannotGetShufflingDependentRoot;
  }

  if (attestationDependentRoot !== stateDependentRoot) {
    return InvalidAttestationData.IncorrectDependentRoot;
  }

  // If the dependent root matches, then the shuffling is valid.
  return null;
}
