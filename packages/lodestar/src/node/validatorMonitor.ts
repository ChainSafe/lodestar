import {computeEpochAtSlot} from "@chainsafe/lodestar-beacon-state-transition";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {Epoch, Slot, ValidatorIndex} from "@chainsafe/lodestar-types";
import {BeaconBlock} from "@chainsafe/lodestar-types/lib/allForks";
import {IndexedAttestation, SignedAggregateAndProof} from "@chainsafe/lodestar-types/phase0";
import {IMetrics} from "../metrics";

/// The validator monitor collects per-epoch data about each monitored validator. Historical data
/// will be kept around for `HISTORIC_EPOCHS` before it is pruned.
const HISTORIC_EPOCHS = 4;

type Seconds = number;
enum OpSource {
  api = "api",
  gossip = "gossip",
}

/// The information required to reward a block producer for including an attestation in a block.
type InclusionInfo = {
  /// The distance between the attestation slot and the slot that attestation was included in a
  /// block.
  delay: number;
  /// The index of the proposer at the slot where the attestation was included.
  proposer_index: ValidatorIndex;
};

/// Information required to reward some validator during the current and previous epoch.
type ValidatorStatus = {
  /// True if the validator has been slashed, ever.
  is_slashed: boolean;
  /// True if the validator can withdraw in the current epoch.
  is_withdrawable_in_current_epoch: boolean;
  /// True if the validator was active in the state's _current_ epoch.
  is_active_in_current_epoch: boolean;
  /// True if the validator was active in the state's _previous_ epoch.
  is_active_in_previous_epoch: boolean;
  /// The validator's effective balance in the _current_ epoch.
  current_epoch_effective_balance: u64;

  /// True if the validator had an attestation included in the _current_ epoch.
  is_current_epoch_attester: boolean;
  /// True if the validator's beacon block root attestation for the first slot of the _current_
  /// epoch matches the block root known to the state.
  is_current_epoch_target_attester: boolean;
  /// True if the validator had an attestation included in the _previous_ epoch.
  is_previous_epoch_attester: boolean;
  /// True if the validator's beacon block root attestation for the first slot of the _previous_
  /// epoch matches the block root known to the state.
  is_previous_epoch_target_attester: boolean;
  /// True if the validator's beacon block root attestation in the _previous_ epoch at the
  /// attestation's slot (`attestation_data.slot`) matches the block root known to the state.
  is_previous_epoch_head_attester: boolean;

  /// Information used to reward the block producer of this validators earliest-included
  /// attestation.
  inclusion_info: InclusionInfo | null;
};

/// Contains data pertaining to one validator for one epoch.
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
  attestationMinBlockInclusionDistance: Slot;
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
      attestationMinBlockInclusionDistance: 0,
      blocks: 0,
      blockMinDelay: null,
      aggregates: 0,
      aggregateMinDelay: null,
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

type PublicKeyHex = string;

/// A validator that is being monitored by the `ValidatorMonitor`.
type MonitoredValidator = {
  /// The validator index in the state.
  index: number;
  /// A history of the validator over time.
  summaries: Map<Epoch, EpochSummary>;
};

export class ValidatorMonitor {
  /// The validators that require additional monitoring.
  private readonly validators = new Map<ValidatorIndex, MonitoredValidator>();
  /// A map of validator index (state.validators) to a validator public key.
  private readonly indices = new Map<ValidatorIndex, PublicKeyHex>();
  /// If true, allow the automatic registration of validators.
  constructor(
    private readonly metrics: IMetrics,
    private readonly config: IBeaconConfig,
    private readonly genesisTime: number
  ) {}

  registerLocalValidator(index: number): void {
    if (!this.validators.has(index)) {
      this.validators.set(index, {index, summaries: new Map<Epoch, EpochSummary>()});
    }
  }

  processValidatorStatuses(epoch: Epoch, summaries: ValidatorStatus[]): void {
    for (const monitoredValidator of this.validators.values()) {
      // We subtract two from the state of the epoch that generated these summaries.
      //
      // - One to account for it being the previous epoch.
      // - One to account for the state advancing an epoch whilst generating the validator
      //     statuses.
      const index = monitoredValidator.index;
      const summary = summaries[index];
      if (!summary) {
        continue;
      }

      if (summary.is_previous_epoch_attester) {
        this.metrics.validatorMonitor.prevEpochOnChainAttesterHit.inc({index});
      } else {
        this.metrics.validatorMonitor.prevEpochOnChainAttesterMiss.inc({index});
      }
      if (summary.is_previous_epoch_head_attester) {
        this.metrics.validatorMonitor.prevEpochOnChainHeadAttesterHit.inc({index});
      } else {
        this.metrics.validatorMonitor.prevEpochOnChainHeadAttesterMiss.inc({index});
      }
      if (summary.is_previous_epoch_target_attester) {
        this.metrics.validatorMonitor.prevEpochOnChainTargetAttesterHit.inc({index});
      } else {
        this.metrics.validatorMonitor.prevEpochOnChainTargetAttesterMiss.inc({index});
      }
      if (summary.inclusion_info) {
        this.metrics.validatorMonitor.prevEpochOnChainInclusionDistance.inc({index});
      }
    }
  }

  registerBeaconBlock(src: OpSource, seenTimestamp: number, block: BeaconBlock): void {
    const index = block.proposerIndex;
    const validator = this.validators.get(index);
    if (validator) {
      // Returns the delay between the start of `block.slot` and `seenTimestamp`.
      const delay = seenTimestamp - (this.genesisTime + block.slot * this.config.params.SECONDS_PER_SLOT);
      this.metrics.validatorMonitor.beaconBlockTotal.inc({src, index});
      this.metrics.validatorMonitor.beaconBlockDelaySeconds.observe({src, index}, delay);
    }
  }

  registerUnaggregatedAttestation(src: OpSource, seenTimestamp: number, indexedAttestation: IndexedAttestation): void {
    const data = indexedAttestation.data;
    const epoch = computeEpochAtSlot(this.config, data.slot);
    // Returns the duration between when the attestation `data` could be produced (1/3rd through the slot) and `seenTimestamp`.
    const delay = seenTimestamp - (this.genesisTime + (data.slot + 1 / 3) * this.config.params.SECONDS_PER_SLOT);

    for (const index of indexedAttestation.attestingIndices) {
      const validator = this.validators.get(index);
      if (validator) {
        this.metrics.validatorMonitor.unaggregatedAttestationTotal.inc({src, index});
        this.metrics.validatorMonitor.unaggregatedAttestationDelaySeconds.observe({src, index}, delay);
        withEpochSummary(validator, epoch, (summary) => {
          summary.attestations += 1;
          summary.attestationMinDelay = Math.min(delay, summary.attestationMinDelay ?? Infinity);
        });
      }
    }
  }

  registerAggregatedAttestation(
    src: OpSource,
    seenTimestamp: number,
    signedAggregateAndProof: SignedAggregateAndProof,
    indexedAttestation: IndexedAttestation
  ): void {
    const data = indexedAttestation.data;
    const epoch = computeEpochAtSlot(this.config, data.slot);
    /// Returns the duration between when a `AggregateAndproof` with `data` could be produced (2/3rd through the slot) and `seenTimestamp`.
    const delay = seenTimestamp - (this.genesisTime + (data.slot + 2 / 3) * this.config.params.SECONDS_PER_SLOT);

    const aggregatorIndex = signedAggregateAndProof.message.aggregatorIndex;
    const validtorAggregator = this.validators.get(aggregatorIndex);
    if (validtorAggregator) {
      const index = aggregatorIndex;
      this.metrics.validatorMonitor.aggregatedAttestationTotal.inc({src, index});
      this.metrics.validatorMonitor.aggregatedAttestationDelaySeconds.observe({src, index}, delay);
      withEpochSummary(validtorAggregator, epoch, (summary) => {
        summary.aggregates += 1;
        summary.aggregateMinDelay = Math.min(delay, summary.aggregateMinDelay ?? Infinity);
      });
    }

    for (const index of indexedAttestation.attestingIndices) {
      const validator = this.validators.get(index);
      if (validator) {
        this.metrics.validatorMonitor.attestationInAggregateTotal.inc({src, index});
        this.metrics.validatorMonitor.attestationInAggregateDelaySeconds.observe({src, index}, delay);
        withEpochSummary(validator, epoch, (summary) => {
          summary.attestationAggregateIncusions += 1;
        });
      }
    }
  }

  // Register that the `indexed_attestation` was included in a *valid* `BeaconBlock`.
  registerAttestationInBlock(indexedAttestation: IndexedAttestation, block: BeaconBlock): void {
    const data = indexedAttestation.data;
    const delay = block.slot - data.slot - this.config.params.MIN_ATTESTATION_INCLUSION_DELAY;
    const epoch = computeEpochAtSlot(this.config, data.slot);

    for (const index of indexedAttestation.attestingIndices) {
      const validator = this.validators.get(index);
      if (validator) {
        this.metrics.validatorMonitor.attestationInBlockTotal.inc({index});
        this.metrics.validatorMonitor.attestationInBlockDelaySlots.observe({index}, delay);
        withEpochSummary(validator, epoch, (summary) => {
          summary.attestationBlockInclusions += 1;
          summary.attestationMinBlockInclusionDistance = Math.min(summary.attestationMinBlockInclusionDistance, delay);
        });
      }
    }
  }

  /// Scrape `self` for metrics.
  ///
  /// Should be called whenever Prometheus is scraping Lighthouse.
  scrapeMetrics(slotClock: Slot): void {
    this.metrics.validatorMonitor.validatorMonitorValidatorsTotal.set(this.validators.size);

    const epoch = computeEpochAtSlot(this.config, slotClock);
    const slotInEpoch = slotClock % this.config.params.SLOTS_PER_EPOCH;

    // Only start to report on the current epoch once we've progressed past the point where
    // all attestation should be included in a block.
    //
    // This allows us to set alarms on Grafana to detect when an attestation has been
    // missed. If we didn't delay beyond the attestation inclusion period then we could
    // expect some occasional false-positives on attestation misses.
    //
    // I have chosen 3 as an arbitrary number where we *probably* shouldn't see that many
    // skip slots on mainnet.
    const previousEpoch = slotInEpoch > this.config.params.MIN_ATTESTATION_INCLUSION_DELAY + 3 ? epoch - 1 : epoch - 2;

    for (const validator of this.validators.values()) {
      const index = validator.index;
      const summary = validator.summaries.get(previousEpoch);
      if (!summary) {
        continue;
      }

      // Attestations
      this.metrics.validatorMonitor.prevEpochAttestationsTotal.set({index}, summary.attestations);
      if (summary.attestationMinDelay !== null)
        this.metrics.validatorMonitor.prevEpochAttestationsMinDelaySeconds.observe(
          {index},
          summary.attestationMinDelay
        );
      this.metrics.validatorMonitor.prevEpochAttestationAggregateInclusions.set(
        {index},
        summary.attestationAggregateIncusions
      );
      this.metrics.validatorMonitor.prevEpochAttestationBlockInclusions.set(
        {index},
        summary.attestationBlockInclusions
      );
      this.metrics.validatorMonitor.prevEpochAttestationBlockMinInclusionDistance.set(
        {index},
        summary.attestationMinBlockInclusionDistance
      );

      // Blocks
      this.metrics.validatorMonitor.prevEpochBeaconBlocksTotal.set({index}, summary.blocks);
      if (summary.blockMinDelay !== null)
        this.metrics.validatorMonitor.prevEpochBeaconBlocksMinDelaySeconds.observe({index}, summary.blockMinDelay);

      // Aggregates
      this.metrics.validatorMonitor.prevEpochAggregatesTotal.set({index}, summary.aggregates);
      if (summary.aggregateMinDelay !== null)
        this.metrics.validatorMonitor.prevEpochAggregatesMinDelaySeconds.observe({index}, summary.aggregateMinDelay);
    }
  }
}
