import {IForkChoice} from "@lodestar/fork-choice";
import {ForkName, ForkSeq, MAX_ATTESTATIONS_ELECTRA, MIN_ATTESTATION_INCLUSION_DELAY} from "@lodestar/params";
import {CachedBeaconStateAllForks, computeEpochAtSlot} from "@lodestar/state-transition";
import {Attestation, CommitteeIndex, electra} from "@lodestar/types";
import type {Metrics} from "../../metrics/index.js";
import type {BeaconChain} from "../chain.js";
import {
  AttestationsConsolidation,
  CommitteeValidatorIndex,
  ConsolidationType,
  ScannedSlotsTerminationReason,
  aggregateConsolidation,
  getNotSeenValidatorsFn,
  getValidateAttestationDataFn,
} from "./aggregatedAttestationPool.js";

/**
 * Get attestations to be included in a block.
 * Post electra, for each slot:
 *   - get attestations from aggregated attestation pool, track not seen committee members from there
 *   - search for missing attestations of those committee members in single attestation pool
 */
export function getAttestationsForBlock(
  this: BeaconChain,
  fork: ForkName,
  forkChoice: IForkChoice,
  state: CachedBeaconStateAllForks
): Attestation[] {
  const forkSeq = ForkSeq[fork];
  if (forkSeq < ForkSeq.electra) {
    return this.aggregatedAttestationPool.getAttestationsForBlockPreElectra(fork, forkChoice, state);
  }

  const stateSlot = state.slot;
  const stateEpoch = state.epochCtx.epoch;
  const statePrevEpoch = stateEpoch - 1;

  // it's important to use the same instance of these functions for both pools
  // for the cache inside them to work well
  const notSeenValidatorsFn = getNotSeenValidatorsFn(state);
  const validateAttestationDataFn = getValidateAttestationDataFn(forkChoice, state);

  const aggregatedAttPoolSlotsDesc = this.aggregatedAttestationPool.getStoredSlots();
  const singleAttestationPoolSlots = this.singleAttestationPool.getStoredSlots();

  // Track score of each `AttestationsConsolidation` from both pools
  const consolidations = new Map<AttestationsConsolidation, {type: ConsolidationType; score: number}>();
  let scannedSlotsAggregatedAttestationPool = 0;
  let scannedSlotsSingleAttestationPool = 0;
  let stopReason: ScannedSlotsTerminationReason | null = null;
  let totalAggregatedAttPoolConsolidations = 0;
  let totalSingleAttestationPoolConsolidations = 0;

  slot: for (const slot of aggregatedAttPoolSlotsDesc) {
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
    let aggregatedAttPoolConsolidations: AttestationsConsolidation[] = [];
    let notSeenCommitteeMembersByIndex: Map<CommitteeIndex, Set<CommitteeValidatorIndex> | null>;
    try {
      const aggAttestationPoolResult = this.aggregatedAttestationPool.getAttestationsForBlockElectraBySlot(
        slot,
        fork,
        state.slot,
        state.epochCtx.effectiveBalanceIncrements,
        notSeenValidatorsFn,
        validateAttestationDataFn
      );
      aggregatedAttPoolConsolidations = aggAttestationPoolResult.consolidations;
      notSeenCommitteeMembersByIndex = aggAttestationPoolResult.notSeenCommitteeMembersByIndex;
    } catch (e) {
      this.logger.debug("Error getting AggregatedAttestations for block production", {slot}, e as Error);
      continue;
    }
    scannedSlotsAggregatedAttestationPool++;
    totalAggregatedAttPoolConsolidations += aggregatedAttPoolConsolidations.length;

    let singleAttConsolidations: AttestationsConsolidation[] = [];
    if (singleAttestationPoolSlots.has(slot)) {
      try {
        singleAttConsolidations = this.singleAttestationPool.getAttestationsForBlockElectraBySlot(
          slot,
          state.slot,
          notSeenCommitteeMembersByIndex,
          state.epochCtx.effectiveBalanceIncrements,
          notSeenValidatorsFn,
          validateAttestationDataFn
        );
        totalSingleAttestationPoolConsolidations += singleAttConsolidations.length;
      } catch (e) {
        this.logger.debug("Error getting SingleAttations for block production", {slot}, e as Error);
        // no need to continue here, we can still process aggregated attestations
      }
    }
    scannedSlotsSingleAttestationPool++;

    for (const {consolidation, type} of [
      ...aggregatedAttPoolConsolidations.map((c) => ({
        consolidation: c,
        type: ConsolidationType.aggregated_attestation_pool,
      })),
      ...singleAttConsolidations.map((c) => ({consolidation: c, type: ConsolidationType.single_attestation_pool})),
    ]) {
      const score = consolidation.totalNewSeenEffectiveBalance / inclusionDistance;
      consolidations.set(consolidation, {type, score});
      // previously we had a limit of 2 * MAX_ATTESTATIONS_ELECTRA, but now we have a limit of MAX_ATTESTATIONS_ELECTRA * 3
      // due to multiple SingleAttestations could be found per slot. This does not affect performance through.
      if (consolidations.size >= MAX_ATTESTATIONS_ELECTRA * 3) {
        stopReason = ScannedSlotsTerminationReason.MaxConsolidationReached;
        break slot;
      }
    }

    // finished processing a slot
  }

  this.metrics?.opPool.aggregatedAttestationPool.packedAttestations.totalConsolidations.set(
    totalAggregatedAttPoolConsolidations
  );
  this.metrics?.opPool.singleAttestationPool.packedAttestations.totalConsolidations.set(
    totalSingleAttestationPoolConsolidations
  );

  const sortedConsolidationsByScore = Array.from(consolidations.entries())
    .sort((a, b) => b[1].score - a[1].score)
    .map(([consolidation, {type}]) => ({consolidation, type}))
    .slice(0, MAX_ATTESTATIONS_ELECTRA);

  // on chain aggregation is expensive, only do it after all
  const aggregatedAttestationsPackedMetrics = this.metrics?.opPool.aggregatedAttestationPool.packedAttestations;
  const singleAttestationPackedMetrics = this.metrics?.opPool.singleAttestationPool.packedAttestations;
  const packedAttestations: electra.Attestation[] = new Array(sortedConsolidationsByScore.length);

  let aggregatedAttestationPoolIndex = 0;
  let singleAttestationPoolIndex = 0;
  for (const [i, {consolidation, type}] of sortedConsolidationsByScore.entries()) {
    packedAttestations[i] = aggregateConsolidation(consolidation);

    // record metrics of packed attestations
    const packedAttestationsMetrics =
      type === ConsolidationType.aggregated_attestation_pool
        ? aggregatedAttestationsPackedMetrics
        : singleAttestationPackedMetrics;
    const index =
      type === ConsolidationType.aggregated_attestation_pool
        ? aggregatedAttestationPoolIndex++
        : singleAttestationPoolIndex++;
    packedAttestationsMetrics?.committeeCount.set({index}, consolidation.byCommittee.size);
    packedAttestationsMetrics?.totalAttesters.set({index}, consolidation.totalAttesters);
    packedAttestationsMetrics?.nonParticipation.set({index}, consolidation.notSeenAttesters);
    packedAttestationsMetrics?.inclusionDistance.set({index}, stateSlot - packedAttestations[i].data.slot);
    packedAttestationsMetrics?.newSeenAttesters.set({index}, consolidation.newSeenAttesters);
    packedAttestationsMetrics?.totalEffectiveBalance.set({index}, consolidation.totalNewSeenEffectiveBalance);
  }

  // reset unused indexes to avoid stale metrics to display on grafana
  resetMetrics(this.metrics, aggregatedAttestationPoolIndex, singleAttestationPoolIndex);

  aggregatedAttestationsPackedMetrics?.packedAttestations.observe(packedAttestations.length);

  if (stopReason === null) {
    stopReason = ScannedSlotsTerminationReason.ScannedAllSlots;
  }

  aggregatedAttestationsPackedMetrics?.scannedSlots.set({reason: stopReason}, scannedSlotsAggregatedAttestationPool);
  singleAttestationPackedMetrics?.scannedSlots.set({reason: stopReason}, scannedSlotsSingleAttestationPool);

  aggregatedAttestationsPackedMetrics?.poolSlots.set(aggregatedAttPoolSlotsDesc.length);
  singleAttestationPackedMetrics?.poolSlots.set(singleAttestationPoolSlots.size);

  return packedAttestations;
}

function resetMetrics(
  metrics: Metrics | null,
  aggregatedAttestationPoolIndex: number,
  singleAttestationPoolIndex: number
): void {
  const aggregatedAttestationsPackedMetrics = metrics?.opPool.aggregatedAttestationPool.packedAttestations;
  for (let index = aggregatedAttestationPoolIndex; index < MAX_ATTESTATIONS_ELECTRA; index++) {
    aggregatedAttestationsPackedMetrics?.committeeCount.set({index}, 0);
    aggregatedAttestationsPackedMetrics?.totalAttesters.set({index}, 0);
    aggregatedAttestationsPackedMetrics?.nonParticipation.set({index}, 0);
    aggregatedAttestationsPackedMetrics?.inclusionDistance.set({index}, 0);
    aggregatedAttestationsPackedMetrics?.newSeenAttesters.set({index}, 0);
    aggregatedAttestationsPackedMetrics?.totalEffectiveBalance.set({index}, 0);
  }

  const singleAttestationPackedMetrics = metrics?.opPool.singleAttestationPool.packedAttestations;
  for (let index = singleAttestationPoolIndex; index < MAX_ATTESTATIONS_ELECTRA; index++) {
    singleAttestationPackedMetrics?.committeeCount.set({index}, 0);
    singleAttestationPackedMetrics?.totalAttesters.set({index}, 0);
    singleAttestationPackedMetrics?.nonParticipation.set({index}, 0);
    singleAttestationPackedMetrics?.inclusionDistance.set({index}, 0);
    singleAttestationPackedMetrics?.newSeenAttesters.set({index}, 0);
    singleAttestationPackedMetrics?.totalEffectiveBalance.set({index}, 0);
  }
}
