import {
  computeEpochAtSlot,
  altair,
  IAttesterStatus,
  parseAttesterFlags,
} from "@chainsafe/lodestar-beacon-state-transition";
import {ILogger} from "@chainsafe/lodestar-utils";
import {allForks} from "@chainsafe/lodestar-beacon-state-transition";
import {IChainForkConfig} from "@chainsafe/lodestar-config";
import {MIN_ATTESTATION_INCLUSION_DELAY, SLOTS_PER_EPOCH} from "@chainsafe/lodestar-params";
import {Epoch, Slot, ValidatorIndex, ssz} from "@chainsafe/lodestar-types";
import {IndexedAttestation, SignedAggregateAndProof} from "@chainsafe/lodestar-types/phase0";
import {ILodestarMetrics} from "./metrics/lodestar";

/** The validator monitor collects per-epoch data about each monitored validator.
 * Historical data will be kept around for `HISTORIC_EPOCHS` before it is pruned.
 */
const HISTORIC_EPOCHS = 4;

type Seconds = number;
export enum OpSource {
  api = "api",
  gossip = "gossip",
}

export interface IValidatorMonitor {
  registerLocalValidator(index: number): void;
  registerValidatorStatuses(currentEpoch: Epoch, statuses: IAttesterStatus[], balances?: number[]): void;
  registerBeaconBlock(src: OpSource, seenTimestampSec: Seconds, block: allForks.BeaconBlock): void;
  submitUnaggregatedAttestation(indexedAttestation: IndexedAttestation, subnet: number, sentPeers: number): void;
  registerUnaggregatedAttestation(
    src: OpSource,
    seenTimestampSec: Seconds,
    indexedAttestation: IndexedAttestation
  ): void;
  submitAggregatedAttestation(indexedAttestation: IndexedAttestation, sentPeers: number): void;
  registerAggregatedAttestation(
    src: OpSource,
    seenTimestampSec: Seconds,
    signedAggregateAndProof: SignedAggregateAndProof,
    indexedAttestation: IndexedAttestation
  ): void;
  registerAttestationInBlock(
    indexedAttestation: IndexedAttestation,
    parentSlot: Slot,
    rootCache: altair.RootCache
  ): void;
  scrapeMetrics(slotClock: Slot): void;
}

/** Information required to reward some validator during the current and previous epoch. */
type ValidatorStatus = {
  /** True if the validator has been slashed, ever. */
  isSlashed: boolean;
  /** True if the validator was active in the state's _current_ epoch. */
  isActiveInCurrentEpoch: boolean;
  /** True if the validator was active in the state's _previous_ epoch. */
  isActiveInPreviousEpoch: boolean;
  /** The validator's effective balance in the _current_ epoch. */
  currentEpochEffectiveBalance: number;

  /** True if the validator had an attestation included in the _previous_ epoch. */
  isPrevSourceAttester: boolean;
  /** True if the validator's beacon block root attestation for the first slot of the _previous_
      epoch matches the block root known to the state. */
  isPrevTargetAttester: boolean;
  /** True if the validator's beacon block root attestation in the _previous_ epoch at the
      attestation's slot (`attestation_data.slot`) matches the block root known to the state. */
  isPrevHeadAttester: boolean;

  /** True if the validator had an attestation included in the _current_ epoch. */
  isCurrSourceAttester: boolean;
  /** True if the validator's beacon block root attestation for the first slot of the _current_
      epoch matches the block root known to the state. */
  isCurrTargetAttester: boolean;
  /** True if the validator's beacon block root attestation in the _current_ epoch at the
      attestation's slot (`attestation_data.slot`) matches the block root known to the state. */
  isCurrHeadAttester: boolean;

  /** The distance between the attestation slot and the slot that attestation was included in a block. */
  inclusionDistance: number;
};

function statusToSummary(status: IAttesterStatus): ValidatorStatus {
  const flags = parseAttesterFlags(status.flags);
  return {
    isSlashed: flags.unslashed,
    isActiveInCurrentEpoch: status.active,
    isActiveInPreviousEpoch: status.active,
    // TODO: Implement
    currentEpochEffectiveBalance: 0,

    isPrevSourceAttester: flags.prevSourceAttester,
    isPrevTargetAttester: flags.prevTargetAttester,
    isPrevHeadAttester: flags.prevHeadAttester,
    isCurrSourceAttester: flags.currSourceAttester,
    isCurrTargetAttester: flags.currTargetAttester,
    isCurrHeadAttester: flags.currHeadAttester,
    inclusionDistance: status.inclusionDelay,
  };
}

/** Contains data pertaining to one validator for one epoch. */
type EpochSummary = {
  // Attestations with a target in the current epoch.
  /** The number of attestations seen. */
  attestations: number;
  /** The delay between when the attestation should have been produced and when it was observed. */
  attestationMinDelay: Seconds | null;
  /** The number of times a validators attestation was seen in an aggregate. */
  attestationAggregateIncusions: number;
  /** The number of times a validators attestation was seen in a block. */
  attestationBlockInclusions: number;
  /** The minimum observed inclusion distance for an attestation for this epoch.. */
  attestationMinBlockInclusionDistance: Slot | null;
  /** The attestation contains the correct head or not */
  attestationCorrectHead: boolean | null;
  // Blocks with a slot in the current epoch.
  /** The number of blocks observed. */
  blocks: number;
  /** The delay between when the block should have been produced and when it was observed. */
  blockMinDelay: Seconds | null;
  // Aggregates with a target in the current epoch
  /** The number of signed aggregate and proofs observed. */
  aggregates: number;
  /** The delay between when the aggregate should have been produced and when it was observed. */
  aggregateMinDelay: Seconds | null;
};

function withEpochSummary(validator: MonitoredValidator, epoch: Epoch, fn: (summary: EpochSummary) => void): void {
  let summary = validator.summaries.get(epoch);
  if (!summary) {
    summary = {
      attestations: 0,
      attestationMinDelay: null,
      attestationAggregateIncusions: 0,
      attestationBlockInclusions: 0,
      attestationMinBlockInclusionDistance: null,
      blocks: 0,
      blockMinDelay: null,
      aggregates: 0,
      aggregateMinDelay: null,
      attestationCorrectHead: null,
    };
    validator.summaries.set(epoch, summary);
  }

  fn(summary);

  // Prune
  const toPrune = validator.summaries.size - HISTORIC_EPOCHS;
  if (toPrune > 0) {
    let pruned = 0;
    for (const idx of validator.summaries.keys()) {
      validator.summaries.delete(idx);
      if (++pruned >= toPrune) break;
    }
  }
}

/// A validator that is being monitored by the `ValidatorMonitor`. */
type MonitoredValidator = {
  /// The validator index in the state. */
  index: number;
  /// A history of the validator over time. */
  summaries: Map<Epoch, EpochSummary>;
};

export function createValidatorMonitor(
  metrics: ILodestarMetrics,
  config: IChainForkConfig,
  genesisTime: number,
  logger: ILogger
): IValidatorMonitor {
  /** The validators that require additional monitoring. */
  const validators = new Map<ValidatorIndex, MonitoredValidator>();

  let lastRegisteredStatusEpoch = -1;

  return {
    registerLocalValidator(index) {
      if (!validators.has(index)) {
        validators.set(index, {index, summaries: new Map<Epoch, EpochSummary>()});
      }
    },

    registerValidatorStatuses(currentEpoch, statuses, balances) {
      // Prevent registering status for the same epoch twice. processEpoch() may be ran more than once for the same epoch.
      if (currentEpoch <= lastRegisteredStatusEpoch) {
        return;
      }
      lastRegisteredStatusEpoch = currentEpoch;
      const previousEpoch = currentEpoch - 1;

      for (const monitoredValidator of validators.values()) {
        // We subtract two from the state of the epoch that generated these summaries.
        //
        // - One to account for it being the previous epoch.
        // - One to account for the state advancing an epoch whilst generating the validator
        //     statuses.
        const index = monitoredValidator.index;
        const status = statuses[index];
        if (status === undefined) {
          continue;
        }

        const summary = statusToSummary(status);
        let failedAttestation = false;

        if (summary.isPrevSourceAttester) {
          metrics.validatorMonitor.prevEpochOnChainAttesterHit.inc({index});
        } else {
          failedAttestation = true;
          metrics.validatorMonitor.prevEpochOnChainAttesterMiss.inc({index});
        }
        if (summary.isPrevHeadAttester) {
          metrics.validatorMonitor.prevEpochOnChainHeadAttesterHit.inc({index});
        } else {
          failedAttestation = true;
          metrics.validatorMonitor.prevEpochOnChainHeadAttesterMiss.inc({index});
        }
        if (summary.isPrevTargetAttester) {
          metrics.validatorMonitor.prevEpochOnChainTargetAttesterHit.inc({index});
        } else {
          failedAttestation = true;
          metrics.validatorMonitor.prevEpochOnChainTargetAttesterMiss.inc({index});
        }

        if (failedAttestation) {
          logger.verbose("Failed attestation in previous epoch", {
            validatorIndex: index,
            currentEpoch,
            isPrevSourceAttester: summary.isPrevSourceAttester,
            isPrevHeadAttester: summary.isPrevHeadAttester,
            isPrevTargetAttester: summary.isPrevTargetAttester,
          });
        }

        const prevEpochSummary = monitoredValidator.summaries.get(previousEpoch);
        const attestationCorrectHead = prevEpochSummary?.attestationCorrectHead;
        if (attestationCorrectHead !== null && attestationCorrectHead !== undefined) {
          metrics.validatorMonitor.prevOnChainAttesterCorrectHead.set({index}, attestationCorrectHead ? 1 : 0);
        }

        const attestationMinBlockInclusionDistance = prevEpochSummary?.attestationMinBlockInclusionDistance;
        const inclusionDistance =
          attestationMinBlockInclusionDistance != null && attestationMinBlockInclusionDistance > 0
            ? // altair, attestation is not missed
              attestationMinBlockInclusionDistance
            : summary.inclusionDistance
            ? // phase0, this is from the state transition
              summary.inclusionDistance
            : null;

        if (inclusionDistance !== null) {
          metrics.validatorMonitor.prevEpochOnChainInclusionDistance.set({index}, inclusionDistance);
        }

        const balance = balances && balances[index];
        if (balance !== undefined) {
          metrics.validatorMonitor.prevEpochOnChainBalance.set({index}, balance);
        }
      }
    },

    registerBeaconBlock(src, seenTimestampSec, block) {
      const index = block.proposerIndex;
      const validator = validators.get(index);
      // Returns the delay between the start of `block.slot` and `seenTimestamp`.
      const delaySec = seenTimestampSec - (genesisTime + block.slot * config.SECONDS_PER_SLOT);
      metrics.gossipBlock.elappsedTimeTillReceived.observe(delaySec);
      if (validator) {
        metrics.validatorMonitor.beaconBlockTotal.inc({src, index});
        metrics.validatorMonitor.beaconBlockDelaySeconds.observe({src, index}, delaySec);
      }
    },

    submitUnaggregatedAttestation(indexedAttestation, subnet, sentPeers) {
      const data = indexedAttestation.data;
      for (const index of indexedAttestation.attestingIndices) {
        const validator = validators.get(index);
        if (validator) {
          if (sentPeers <= 0) {
            metrics.validatorMonitor.unaggregatedAttestationSubmittedSentPeers.observe({index}, sentPeers);
          }
          logger.verbose("Local validator published unaggregated attestation", {
            validatorIndex: validator.index,
            slot: data.slot,
            committeeIndex: data.index,
            subnet,
            sentPeers,
          });
        }
      }
    },

    registerUnaggregatedAttestation(src, seenTimestampSec, indexedAttestation) {
      const data = indexedAttestation.data;
      const epoch = computeEpochAtSlot(data.slot);
      // Returns the duration between when the attestation `data` could be produced (1/3rd through the slot) and `seenTimestamp`.
      const delaySec = seenTimestampSec - (genesisTime + (data.slot + 1 / 3) * config.SECONDS_PER_SLOT);

      for (const index of indexedAttestation.attestingIndices) {
        const validator = validators.get(index);
        if (validator) {
          metrics.validatorMonitor.unaggregatedAttestationTotal.inc({src, index});
          metrics.validatorMonitor.unaggregatedAttestationDelaySeconds.observe({src, index}, delaySec);
          withEpochSummary(validator, epoch, (summary) => {
            summary.attestations += 1;
            summary.attestationMinDelay = Math.min(delaySec, summary.attestationMinDelay ?? Infinity);
          });
        }
      }
    },

    submitAggregatedAttestation(indexedAttestation, sentPeers) {
      const data = indexedAttestation.data;
      for (const index of indexedAttestation.attestingIndices) {
        const validator = validators.get(index);
        if (validator) {
          logger.verbose("Local validator published aggregated attestation", {
            validatorIndex: validator.index,
            slot: data.slot,
            committeeIndex: data.index,
            sentPeers,
          });
        }
      }
    },

    registerAggregatedAttestation(src, seenTimestampSec, signedAggregateAndProof, indexedAttestation) {
      const data = indexedAttestation.data;
      const epoch = computeEpochAtSlot(data.slot);
      // Returns the duration between when a `AggregateAndproof` with `data` could be produced (2/3rd through the slot) and `seenTimestamp`.
      const delaySec = seenTimestampSec - (genesisTime + (data.slot + 2 / 3) * config.SECONDS_PER_SLOT);

      const aggregatorIndex = signedAggregateAndProof.message.aggregatorIndex;
      const validtorAggregator = validators.get(aggregatorIndex);
      if (validtorAggregator) {
        const index = aggregatorIndex;
        metrics.validatorMonitor.aggregatedAttestationTotal.inc({src, index});
        metrics.validatorMonitor.aggregatedAttestationDelaySeconds.observe({src, index}, delaySec);
        withEpochSummary(validtorAggregator, epoch, (summary) => {
          summary.aggregates += 1;
          summary.aggregateMinDelay = Math.min(delaySec, summary.aggregateMinDelay ?? Infinity);
        });
      }

      for (const index of indexedAttestation.attestingIndices) {
        const validator = validators.get(index);
        if (validator) {
          metrics.validatorMonitor.attestationInAggregateTotal.inc({src, index});
          metrics.validatorMonitor.attestationInAggregateDelaySeconds.observe({src, index}, delaySec);
          withEpochSummary(validator, epoch, (summary) => {
            summary.attestationAggregateIncusions += 1;
          });
          logger.verbose("Local validator attestation is included in AggregatedAndProof", {
            validatorIndex: validator.index,
            slot: data.slot,
            committeeIndex: data.index,
          });
        }
      }
    },

    // Register that the `indexed_attestation` was included in a *valid* `BeaconBlock`.
    registerAttestationInBlock(indexedAttestation, parentSlot, rootCache): void {
      const data = indexedAttestation.data;
      // optimal inclusion distance, not to count skipped slots between data.slot and blockSlot
      const inclusionDistance = Math.max(parentSlot - data.slot, 0) + 1;
      const delay = inclusionDistance - MIN_ATTESTATION_INCLUSION_DELAY;
      const epoch = computeEpochAtSlot(data.slot);
      let correctHead: boolean | null = null;
      for (const index of indexedAttestation.attestingIndices) {
        const validator = validators.get(index);
        if (validator) {
          metrics.validatorMonitor.attestationInBlockTotal.inc({index});
          metrics.validatorMonitor.attestationInBlockDelaySlots.observe({index}, delay);

          withEpochSummary(validator, epoch, (summary) => {
            summary.attestationBlockInclusions += 1;
            if (summary.attestationMinBlockInclusionDistance !== null) {
              summary.attestationMinBlockInclusionDistance = Math.min(
                summary.attestationMinBlockInclusionDistance,
                inclusionDistance
              );
            } else {
              summary.attestationMinBlockInclusionDistance = inclusionDistance;
            }

            if (correctHead === null) {
              correctHead = ssz.Root.equals(rootCache.getBlockRootAtSlot(data.slot), data.beaconBlockRoot);
            }
            summary.attestationCorrectHead = correctHead;
          });

          logger.verbose("Local validator attestation is included in block", {
            validatorIndex: validator.index,
            slot: data.slot,
            committeeIndex: data.index,
            inclusionDistance,
            correctHead,
          });
        }
      }
    },

    /**
     * Scrape `self` for metrics.
     * Should be called whenever Prometheus is scraping.
     */
    scrapeMetrics(slotClock) {
      metrics.validatorMonitor.validatorsTotal.set(validators.size);

      const epoch = computeEpochAtSlot(slotClock);
      const slotInEpoch = slotClock % SLOTS_PER_EPOCH;

      // Only start to report on the current epoch once we've progressed past the point where
      // all attestation should be included in a block.
      //
      // This allows us to set alarms on Grafana to detect when an attestation has been
      // missed. If we didn't delay beyond the attestation inclusion period then we could
      // expect some occasional false-positives on attestation misses.
      //
      // I have chosen 3 as an arbitrary number where we *probably* shouldn't see that many
      // skip slots on mainnet.
      const previousEpoch = slotInEpoch > MIN_ATTESTATION_INCLUSION_DELAY + 3 ? epoch - 1 : epoch - 2;

      for (const validator of validators.values()) {
        const index = validator.index;
        const summary = validator.summaries.get(previousEpoch);
        if (!summary) {
          continue;
        }

        // Attestations
        metrics.validatorMonitor.prevEpochAttestationsTotal.set({index}, summary.attestations);
        if (summary.attestationMinDelay !== null)
          metrics.validatorMonitor.prevEpochAttestationsMinDelaySeconds.observe({index}, summary.attestationMinDelay);
        metrics.validatorMonitor.prevEpochAttestationAggregateInclusions.set(
          {index},
          summary.attestationAggregateIncusions
        );
        metrics.validatorMonitor.prevEpochAttestationBlockInclusions.set({index}, summary.attestationBlockInclusions);
        if (summary.attestationMinBlockInclusionDistance !== null) {
          metrics.validatorMonitor.prevEpochAttestationBlockMinInclusionDistance.set(
            {index},
            summary.attestationMinBlockInclusionDistance
          );
        }

        // Blocks
        metrics.validatorMonitor.prevEpochBeaconBlocksTotal.set({index}, summary.blocks);
        if (summary.blockMinDelay !== null)
          metrics.validatorMonitor.prevEpochBeaconBlocksMinDelaySeconds.observe({index}, summary.blockMinDelay);

        // Aggregates
        metrics.validatorMonitor.prevEpochAggregatesTotal.set({index}, summary.aggregates);
        if (summary.aggregateMinDelay !== null)
          metrics.validatorMonitor.prevEpochAggregatesMinDelaySeconds.observe({index}, summary.aggregateMinDelay);
      }
    },
  };
}
