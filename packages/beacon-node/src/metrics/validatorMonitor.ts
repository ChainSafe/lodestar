import {
  computeEpochAtSlot,
  AttesterStatus,
  parseAttesterFlags,
  CachedBeaconStateAllForks,
  CachedBeaconStateAltair,
  parseParticipationFlags,
  computeStartSlotAtEpoch,
  getBlockRootAtSlot,
  ParticipationFlags,
} from "@lodestar/state-transition";
import {Logger, MapDef, MapDefMax, toHex} from "@lodestar/utils";
import {RootHex, allForks, altair, deneb} from "@lodestar/types";
import {ChainConfig, ChainForkConfig} from "@lodestar/config";
import {ForkSeq, INTERVALS_PER_SLOT, MIN_ATTESTATION_INCLUSION_DELAY, SLOTS_PER_EPOCH} from "@lodestar/params";
import {Epoch, Slot, ValidatorIndex} from "@lodestar/types";
import {IndexedAttestation, SignedAggregateAndProof} from "@lodestar/types/phase0";
import {GENESIS_SLOT} from "../constants/constants.js";
import {LodestarMetrics} from "./metrics/lodestar.js";

/** The validator monitor collects per-epoch data about each monitored validator.
 * Historical data will be kept around for `HISTORIC_EPOCHS` before it is pruned.
 */
const MAX_CACHED_EPOCHS = 4;

const MAX_CACHED_DISTINCT_TARGETS = 4;

const INTERVALS_LATE_ATTESTATION_SUBMISSION = 1.5;
const INTERVALS_LATE_BLOCK_SUBMISSION = 0.75;

const RETAIN_REGISTERED_VALIDATORS_MS = 12 * 3600 * 1000; // 12 hours

type Seconds = number;
export enum OpSource {
  api = "api",
  gossip = "gossip",
}

export type ValidatorMonitor = {
  registerLocalValidator(index: number): void;
  registerLocalValidatorInSyncCommittee(index: number, untilEpoch: Epoch): void;
  registerValidatorStatuses(currentEpoch: Epoch, statuses: AttesterStatus[], balances?: number[]): void;
  registerBeaconBlock(src: OpSource, seenTimestampSec: Seconds, block: allForks.BeaconBlock): void;
  registerBlobSidecar(src: OpSource, seenTimestampSec: Seconds, blob: deneb.BlobSidecar): void;
  registerImportedBlock(block: allForks.BeaconBlock, data: {proposerBalanceDelta: number}): void;
  onPoolSubmitUnaggregatedAttestation(
    seenTimestampSec: number,
    indexedAttestation: IndexedAttestation,
    subnet: number,
    sentPeers: number
  ): void;
  onPoolSubmitAggregatedAttestation(
    seenTimestampSec: number,
    indexedAttestation: IndexedAttestation,
    sentPeers: number
  ): void;
  registerGossipUnaggregatedAttestation(seenTimestampSec: Seconds, indexedAttestation: IndexedAttestation): void;
  registerGossipAggregatedAttestation(
    seenTimestampSec: Seconds,
    signedAggregateAndProof: SignedAggregateAndProof,
    indexedAttestation: IndexedAttestation
  ): void;
  registerAttestationInBlock(
    indexedAttestation: IndexedAttestation,
    parentSlot: Slot,
    correctHead: boolean,
    missedSlotVote: boolean,
    inclusionBlockRoot: RootHex,
    inclusionBlockSlot: Slot
  ): void;
  registerGossipSyncContributionAndProof(
    syncContributionAndProof: altair.ContributionAndProof,
    syncCommitteeParticipantIndices: ValidatorIndex[]
  ): void;
  registerSyncAggregateInBlock(epoch: Epoch, syncAggregate: altair.SyncAggregate, syncCommitteeIndices: number[]): void;
  onceEveryEndOfEpoch(state: CachedBeaconStateAllForks): void;
  scrapeMetrics(slotClock: Slot): void;
};

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

function statusToSummary(status: AttesterStatus): ValidatorStatus {
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
  /** Count of times validator expected in sync aggregate participated */
  syncCommitteeHits: number;
  /** Count of times validator expected in sync aggregate failed to participate */
  syncCommitteeMisses: number;
  /** Number of times a validator's sync signature was seen in an aggregate */
  syncSignatureAggregateInclusions: number;
  /** Submitted proposals from this validator at this epoch */
  blockProposals: BlockProposals[];
};

type BlockProposals = {
  blockRoot: RootHex;
  blockSlot: Slot;
  poolSubmitDelaySec: number | null;
  successfullyImported: boolean;
};

function getEpochSummary(validator: MonitoredValidator, epoch: Epoch): EpochSummary {
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
      syncCommitteeHits: 0,
      syncCommitteeMisses: 0,
      syncSignatureAggregateInclusions: 0,
      blockProposals: [],
    };
    validator.summaries.set(epoch, summary);
  }

  // Prune
  const toPrune = validator.summaries.size - MAX_CACHED_EPOCHS;
  if (toPrune > 0) {
    let pruned = 0;
    for (const idx of validator.summaries.keys()) {
      validator.summaries.delete(idx);
      if (++pruned >= toPrune) break;
    }
  }

  return summary;
}

// To uniquely identify an attestation:
// `index=$validator_index target=$target_epoch:$target_root
type AttestationSummary = {
  poolSubmitDelayMinSec: number | null;
  poolSubmitSentPeers: number | null;
  aggregateInclusionDelaysSec: number[];
  blockInclusions: AttestationBlockInclusion[];
};

type AttestationBlockInclusion = {
  blockRoot: RootHex;
  blockSlot: Slot;
  votedCorrectHeadRoot: boolean;
  votedForMissedSlot: boolean;
  attestationSlot: Slot;
};

/** `$target_epoch:$target_root` */
type TargetRoot = string;

/// A validator that is being monitored by the `ValidatorMonitor`. */
type MonitoredValidator = {
  /// A history of the validator over time. */
  summaries: Map<Epoch, EpochSummary>;
  inSyncCommitteeUntilEpoch: number;
  // Unless the validator slashes itself, there MUST be one attestation per target checkpoint
  attestations: MapDefMax<Epoch, MapDefMax<TargetRoot, AttestationSummary>>;
  lastRegisteredTimeMs: number;
};

export function createValidatorMonitor(
  metrics: LodestarMetrics,
  config: ChainForkConfig,
  genesisTime: number,
  logger: Logger
): ValidatorMonitor {
  /** The validators that require additional monitoring. */
  const validators = new MapDef<ValidatorIndex, MonitoredValidator>(() => ({
    summaries: new Map<Epoch, EpochSummary>(),
    inSyncCommitteeUntilEpoch: -1,
    attestations: new MapDefMax(
      () =>
        new MapDefMax(
          () => ({
            poolSubmitDelayMinSec: null,
            poolSubmitSentPeers: null,
            aggregateInclusionDelaysSec: [],
            blockInclusions: [],
          }),
          MAX_CACHED_DISTINCT_TARGETS
        ),
      MAX_CACHED_EPOCHS
    ),
    lastRegisteredTimeMs: 0,
  }));

  let lastRegisteredStatusEpoch = -1;

  return {
    registerLocalValidator(index) {
      validators.getOrDefault(index).lastRegisteredTimeMs = Date.now();
    },

    registerLocalValidatorInSyncCommittee(index, untilEpoch) {
      const validator = validators.get(index);
      if (validator) {
        validator.inSyncCommitteeUntilEpoch = Math.max(untilEpoch, validator.inSyncCommitteeUntilEpoch ?? -1);
      }
    },

    registerValidatorStatuses(currentEpoch, statuses, balances) {
      // Prevent registering status for the same epoch twice. processEpoch() may be ran more than once for the same epoch.
      if (currentEpoch <= lastRegisteredStatusEpoch) {
        return;
      }
      lastRegisteredStatusEpoch = currentEpoch;
      const previousEpoch = currentEpoch - 1;

      for (const [index, monitoredValidator] of validators.entries()) {
        // We subtract two from the state of the epoch that generated these summaries.
        //
        // - One to account for it being the previous epoch.
        // - One to account for the state advancing an epoch whilst generating the validator
        //     statuses.
        const status = statuses[index];
        if (status === undefined) {
          continue;
        }

        const summary = statusToSummary(status);

        if (summary.isPrevSourceAttester) {
          metrics.validatorMonitor.prevEpochOnChainSourceAttesterHit.inc();
        } else {
          metrics.validatorMonitor.prevEpochOnChainSourceAttesterMiss.inc();
        }
        if (summary.isPrevHeadAttester) {
          metrics.validatorMonitor.prevEpochOnChainHeadAttesterHit.inc();
        } else {
          metrics.validatorMonitor.prevEpochOnChainHeadAttesterMiss.inc();
        }
        if (summary.isPrevTargetAttester) {
          metrics.validatorMonitor.prevEpochOnChainTargetAttesterHit.inc();
        } else {
          metrics.validatorMonitor.prevEpochOnChainTargetAttesterMiss.inc();
        }

        const prevEpochSummary = monitoredValidator.summaries.get(previousEpoch);
        const attestationCorrectHead = prevEpochSummary?.attestationCorrectHead;
        if (attestationCorrectHead !== null && attestationCorrectHead !== undefined) {
          if (attestationCorrectHead) {
            metrics.validatorMonitor.prevOnChainAttesterCorrectHead.inc();
          } else {
            metrics.validatorMonitor.prevOnChainAttesterIncorrectHead.inc();
          }
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
          metrics.validatorMonitor.prevEpochOnChainInclusionDistance.observe(inclusionDistance);
          metrics.validatorMonitor.prevEpochOnChainAttesterHit.inc();
        } else {
          metrics.validatorMonitor.prevEpochOnChainAttesterMiss.inc();
        }

        const balance = balances?.[index];
        if (balance !== undefined) {
          metrics.validatorMonitor.prevEpochOnChainBalance.set({index}, balance);
        }

        if (!summary.isPrevSourceAttester || !summary.isPrevTargetAttester || !summary.isPrevHeadAttester) {
          logger.debug("Failed attestation in previous epoch", {
            validatorIndex: index,
            prevEpoch: currentEpoch - 1,
            isPrevSourceAttester: summary.isPrevSourceAttester,
            isPrevHeadAttester: summary.isPrevHeadAttester,
            isPrevTargetAttester: summary.isPrevTargetAttester,
            // inclusionDistance is not available in summary since altair
            inclusionDistance,
          });
        }
      }
    },

    registerBeaconBlock(src, seenTimestampSec, block) {
      const validator = validators.get(block.proposerIndex);
      // Returns the delay between the start of `block.slot` and `seenTimestamp`.
      const delaySec = seenTimestampSec - (genesisTime + block.slot * config.SECONDS_PER_SLOT);
      metrics.gossipBlock.elapsedTimeTillReceived.observe(delaySec);
      if (validator) {
        metrics.validatorMonitor.beaconBlockTotal.inc({src});
        metrics.validatorMonitor.beaconBlockDelaySeconds.observe({src}, delaySec);

        const summary = getEpochSummary(validator, computeEpochAtSlot(block.slot));
        summary.blockProposals.push({
          blockRoot: toHex(config.getForkTypes(block.slot).BeaconBlock.hashTreeRoot(block)),
          blockSlot: block.slot,
          poolSubmitDelaySec: delaySec,
          successfullyImported: false,
        });
      }
    },

    registerBlobSidecar(_src, _seenTimestampSec, _blob) {
      //TODO: freetheblobs
    },

    registerImportedBlock(block, {proposerBalanceDelta}) {
      const validator = validators.get(block.proposerIndex);
      if (validator) {
        metrics.validatorMonitor.proposerBalanceDeltaKnown.observe(proposerBalanceDelta);

        // There should be alredy a summary for the block. Could be missing when using one VC multiple BNs
        const summary = getEpochSummary(validator, computeEpochAtSlot(block.slot));
        const proposal = summary.blockProposals.find((p) => p.blockSlot === block.slot);
        if (proposal) {
          proposal.successfullyImported = true;
        } else {
          summary.blockProposals.push({
            blockRoot: toHex(config.getForkTypes(block.slot).BeaconBlock.hashTreeRoot(block)),
            blockSlot: block.slot,
            poolSubmitDelaySec: null,
            successfullyImported: true,
          });
        }
      }
    },

    onPoolSubmitUnaggregatedAttestation(seenTimestampSec, indexedAttestation, subnet, sentPeers) {
      const data = indexedAttestation.data;
      // Returns the duration between when the attestation `data` could be produced (1/3rd through the slot) and `seenTimestamp`.
      const delaySec = seenTimestampSec - (genesisTime + (data.slot + 1 / 3) * config.SECONDS_PER_SLOT);
      for (const index of indexedAttestation.attestingIndices) {
        const validator = validators.get(index);
        if (validator) {
          metrics.validatorMonitor.unaggregatedAttestationSubmittedSentPeers.observe(sentPeers);
          metrics.validatorMonitor.unaggregatedAttestationDelaySeconds.observe({src: OpSource.api}, delaySec);
          logger.debug("Local validator published unaggregated attestation", {
            validatorIndex: index,
            slot: data.slot,
            committeeIndex: data.index,
            subnet,
            sentPeers,
            delaySec,
          });

          const attestationSummary = validator.attestations
            .getOrDefault(indexedAttestation.data.target.epoch)
            .getOrDefault(toHex(indexedAttestation.data.target.root));
          if (
            attestationSummary.poolSubmitDelayMinSec === null ||
            attestationSummary.poolSubmitDelayMinSec > delaySec
          ) {
            attestationSummary.poolSubmitDelayMinSec = delaySec;
          }
        }
      }
    },

    registerGossipUnaggregatedAttestation(seenTimestampSec, indexedAttestation) {
      const src = OpSource.gossip;
      const data = indexedAttestation.data;
      const epoch = computeEpochAtSlot(data.slot);
      // Returns the duration between when the attestation `data` could be produced (1/3rd through the slot) and `seenTimestamp`.
      const delaySec = seenTimestampSec - (genesisTime + (data.slot + 1 / 3) * config.SECONDS_PER_SLOT);

      for (const index of indexedAttestation.attestingIndices) {
        const validator = validators.get(index);
        if (validator) {
          metrics.validatorMonitor.unaggregatedAttestationTotal.inc({src});
          metrics.validatorMonitor.unaggregatedAttestationDelaySeconds.observe({src}, delaySec);
          const summary = getEpochSummary(validator, epoch);
          summary.attestations += 1;
          summary.attestationMinDelay = Math.min(delaySec, summary.attestationMinDelay ?? Infinity);
        }
      }
    },

    onPoolSubmitAggregatedAttestation(seenTimestampSec, indexedAttestation, sentPeers) {
      const data = indexedAttestation.data;
      // Returns the duration between when a `AggregateAndproof` with `data` could be produced (2/3rd through the slot) and `seenTimestamp`.
      const delaySec = seenTimestampSec - (genesisTime + (data.slot + 2 / 3) * config.SECONDS_PER_SLOT);

      for (const index of indexedAttestation.attestingIndices) {
        const validator = validators.get(index);
        if (validator) {
          metrics.validatorMonitor.aggregatedAttestationDelaySeconds.observe({src: OpSource.api}, delaySec);
          logger.debug("Local validator published aggregated attestation", {
            validatorIndex: index,
            slot: data.slot,
            committeeIndex: data.index,
            sentPeers,
            delaySec,
          });

          validator.attestations
            .getOrDefault(indexedAttestation.data.target.epoch)
            .getOrDefault(toHex(indexedAttestation.data.target.root))
            .aggregateInclusionDelaysSec.push(delaySec);
        }
      }
    },

    registerGossipAggregatedAttestation(seenTimestampSec, signedAggregateAndProof, indexedAttestation) {
      const src = OpSource.gossip;
      const data = indexedAttestation.data;
      const epoch = computeEpochAtSlot(data.slot);
      // Returns the duration between when a `AggregateAndproof` with `data` could be produced (2/3rd through the slot) and `seenTimestamp`.
      const delaySec = seenTimestampSec - (genesisTime + (data.slot + 2 / 3) * config.SECONDS_PER_SLOT);

      const aggregatorIndex = signedAggregateAndProof.message.aggregatorIndex;
      const validtorAggregator = validators.get(aggregatorIndex);
      if (validtorAggregator) {
        metrics.validatorMonitor.aggregatedAttestationTotal.inc({src});
        metrics.validatorMonitor.aggregatedAttestationDelaySeconds.observe({src}, delaySec);
        const summary = getEpochSummary(validtorAggregator, epoch);
        summary.aggregates += 1;
        summary.aggregateMinDelay = Math.min(delaySec, summary.aggregateMinDelay ?? Infinity);
      }

      for (const index of indexedAttestation.attestingIndices) {
        const validator = validators.get(index);
        if (validator) {
          metrics.validatorMonitor.attestationInAggregateTotal.inc({src});
          metrics.validatorMonitor.attestationInAggregateDelaySeconds.observe({src}, delaySec);
          const summary = getEpochSummary(validator, epoch);
          summary.attestationAggregateIncusions += 1;
          logger.debug("Local validator attestation is included in AggregatedAndProof", {
            validatorIndex: index,
            slot: data.slot,
            committeeIndex: data.index,
          });

          validator.attestations
            .getOrDefault(indexedAttestation.data.target.epoch)
            .getOrDefault(toHex(indexedAttestation.data.target.root))
            .aggregateInclusionDelaysSec.push(delaySec);
        }
      }
    },

    // Register that the `indexed_attestation` was included in a *valid* `BeaconBlock`.
    registerAttestationInBlock(
      indexedAttestation,
      parentSlot,
      correctHead,
      missedSlotVote,
      inclusionBlockRoot,
      inclusionBlockSlot
    ): void {
      const data = indexedAttestation.data;
      // optimal inclusion distance, not to count skipped slots between data.slot and blockSlot
      const inclusionDistance = Math.max(parentSlot - data.slot, 0) + 1;
      const delay = inclusionDistance - MIN_ATTESTATION_INCLUSION_DELAY;
      const epoch = computeEpochAtSlot(data.slot);
      const participants = indexedAttestation.attestingIndices.length;

      for (const index of indexedAttestation.attestingIndices) {
        const validator = validators.get(index);
        if (validator) {
          metrics.validatorMonitor.attestationInBlockTotal.inc();
          metrics.validatorMonitor.attestationInBlockDelaySlots.observe(delay);
          metrics.validatorMonitor.attestationInBlockParticipants.observe(participants);

          const summary = getEpochSummary(validator, epoch);
          summary.attestationBlockInclusions += 1;
          if (summary.attestationMinBlockInclusionDistance !== null) {
            summary.attestationMinBlockInclusionDistance = Math.min(
              summary.attestationMinBlockInclusionDistance,
              inclusionDistance
            );
          } else {
            summary.attestationMinBlockInclusionDistance = inclusionDistance;
          }

          summary.attestationCorrectHead = correctHead;

          validator.attestations
            .getOrDefault(indexedAttestation.data.target.epoch)
            .getOrDefault(toHex(indexedAttestation.data.target.root))
            .blockInclusions.push({
              blockRoot: inclusionBlockRoot,
              blockSlot: inclusionBlockSlot,
              votedCorrectHeadRoot: correctHead,
              votedForMissedSlot: missedSlotVote,
              attestationSlot: indexedAttestation.data.slot,
            });

          logger.debug("Local validator attestation is included in block", {
            validatorIndex: index,
            slot: data.slot,
            committeeIndex: data.index,
            inclusionDistance,
            correctHead,
            participants,
          });
        }
      }
    },

    registerGossipSyncContributionAndProof(syncContributionAndProof, syncCommitteeParticipantIndices) {
      const epoch = computeEpochAtSlot(syncContributionAndProof.contribution.slot);

      for (const index of syncCommitteeParticipantIndices) {
        const validator = validators.get(index);
        if (validator) {
          metrics.validatorMonitor.syncSignatureInAggregateTotal.inc();

          const summary = getEpochSummary(validator, epoch);
          summary.syncSignatureAggregateInclusions += 1;
        }
      }
    },

    registerSyncAggregateInBlock(epoch, syncAggregate, syncCommitteeIndices) {
      for (let i = 0; i < syncCommitteeIndices.length; i++) {
        const validator = validators.get(syncCommitteeIndices[i]);
        if (validator) {
          const summary = getEpochSummary(validator, epoch);
          if (syncAggregate.syncCommitteeBits.get(i)) {
            summary.syncCommitteeHits++;
          } else {
            summary.syncCommitteeMisses++;
          }
        }
      }
    },

    // Validator monitor tracks performance of validators in healthy network conditions.
    // It does not attempt to track correctly duties on forking conditions deeper than 1 epoch.
    // To guard against short re-orgs it will track the status of epoch N at the end of epoch N+1.
    // This function **SHOULD** be called at the last slot of an epoch to have max possible information.
    onceEveryEndOfEpoch(headState) {
      if (headState.slot <= GENESIS_SLOT) {
        // Before genesis, there won't be any validator activity
        return;
      }

      // Prune validators not seen in a while
      for (const [index, validator] of validators.entries()) {
        if (Date.now() - validator.lastRegisteredTimeMs > RETAIN_REGISTERED_VALIDATORS_MS) {
          validators.delete(index);
        }
      }

      // Compute summaries of previous epoch attestation performance
      const prevEpoch = Math.max(0, computeEpochAtSlot(headState.slot) - 1);
      const rootCache = new RootHexCache(headState);

      if (config.getForkSeq(headState.slot) >= ForkSeq.altair) {
        const {previousEpochParticipation} = headState as CachedBeaconStateAltair;
        const prevEpochStartSlot = computeStartSlotAtEpoch(prevEpoch);
        const prevEpochTargetRoot = toHex(getBlockRootAtSlot(headState, prevEpochStartSlot));

        // Check attestation performance
        for (const [index, validator] of validators.entries()) {
          const flags = parseParticipationFlags(previousEpochParticipation.get(index));
          const attestationSummary = validator.attestations.get(prevEpoch)?.get(prevEpochTargetRoot);
          metrics.validatorMonitor.prevEpochAttestationSummary.inc({
            summary: renderAttestationSummary(config, rootCache, attestationSummary, flags),
          });
        }
      }

      if (headState.epochCtx.proposersPrevEpoch !== null) {
        // proposersPrevEpoch is null on the first epoch of `headState` being generated
        for (const [slotIndex, validatorIndex] of headState.epochCtx.proposersPrevEpoch.entries()) {
          const validator = validators.get(validatorIndex);
          if (validator) {
            // If expected proposer is a tracked validator
            const summary = validator.summaries.get(prevEpoch);
            metrics.validatorMonitor.prevEpochBlockProposalSummary.inc({
              summary: renderBlockProposalSummary(config, rootCache, summary, SLOTS_PER_EPOCH * prevEpoch + slotIndex),
            });
          }
        }
      }
    },

    /**
     * Scrape `self` for metrics.
     * Should be called whenever Prometheus is scraping.
     */
    scrapeMetrics(slotClock) {
      metrics.validatorMonitor.validatorsConnected.set(validators.size);

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

      // reset() to mimic the behaviour of an aggregated .set({index})
      metrics.validatorMonitor.prevEpochAttestations.reset();
      metrics.validatorMonitor.prevEpochAttestationsMinDelaySeconds.reset();
      metrics.validatorMonitor.prevEpochAttestationAggregateInclusions.reset();
      metrics.validatorMonitor.prevEpochAttestationBlockInclusions.reset();
      metrics.validatorMonitor.prevEpochAttestationBlockMinInclusionDistance.reset();
      metrics.validatorMonitor.prevEpochSyncSignatureAggregateInclusions.reset();

      let validatorsInSyncCommittee = 0;
      let prevEpochSyncCommitteeHits = 0;
      let prevEpochSyncCommitteeMisses = 0;

      for (const validator of validators.values()) {
        // Participation in sync committee
        const validatorInSyncCommittee = validator.inSyncCommitteeUntilEpoch >= epoch;
        if (validatorInSyncCommittee) {
          validatorsInSyncCommittee++;
        }

        // Prev-epoch summary
        const summary = validator.summaries.get(previousEpoch);
        if (!summary) {
          continue;
        }

        // Attestations
        metrics.validatorMonitor.prevEpochAttestations.observe(summary.attestations);
        if (summary.attestationMinDelay !== null)
          metrics.validatorMonitor.prevEpochAttestationsMinDelaySeconds.observe(summary.attestationMinDelay);
        metrics.validatorMonitor.prevEpochAttestationAggregateInclusions.observe(summary.attestationAggregateIncusions);
        metrics.validatorMonitor.prevEpochAttestationBlockInclusions.observe(summary.attestationBlockInclusions);
        if (summary.attestationMinBlockInclusionDistance !== null) {
          metrics.validatorMonitor.prevEpochAttestationBlockMinInclusionDistance.observe(
            summary.attestationMinBlockInclusionDistance
          );
        }

        // Blocks
        metrics.validatorMonitor.prevEpochBeaconBlocks.observe(summary.blocks);
        if (summary.blockMinDelay !== null)
          metrics.validatorMonitor.prevEpochBeaconBlocksMinDelaySeconds.observe(summary.blockMinDelay);

        // Aggregates
        metrics.validatorMonitor.prevEpochAggregatesTotal.observe(summary.aggregates);
        if (summary.aggregateMinDelay !== null)
          metrics.validatorMonitor.prevEpochAggregatesMinDelaySeconds.observe(summary.aggregateMinDelay);

        // Sync committee
        prevEpochSyncCommitteeHits += summary.syncCommitteeHits;
        prevEpochSyncCommitteeMisses += summary.syncCommitteeMisses;

        // Only observe if included in sync committee to prevent distorting metrics
        if (validatorInSyncCommittee) {
          metrics.validatorMonitor.prevEpochSyncSignatureAggregateInclusions.observe(
            summary.syncSignatureAggregateInclusions
          );
        }
      }

      metrics.validatorMonitor.validatorsInSyncCommittee.set(validatorsInSyncCommittee);
      metrics.validatorMonitor.prevEpochSyncCommitteeHits.set(prevEpochSyncCommitteeHits);
      metrics.validatorMonitor.prevEpochSyncCommitteeMisses.set(prevEpochSyncCommitteeMisses);
    },
  };
}

/**
 * Best guess to automatically debug why validators do not achieve expected rewards.
 * Tries to answer common questions such as:
 * - Did the validator submit the attestation to this block?
 * - Was the attestation seen in an aggregate?
 * - Was the attestation seen in a block?
 */
function renderAttestationSummary(
  config: ChainConfig,
  rootCache: RootHexCache,
  summary: AttestationSummary | undefined,
  flags: ParticipationFlags
): string {
  // Reference https://github.com/ethereum/consensus-specs/blob/dev/specs/altair/beacon-chain.md#get_attestation_participation_flag_indices
  //
  // is_matching_source = data.source == justified_checkpoint
  // is_matching_target = is_matching_source and data.target.root == get_block_root(state, data.target.epoch)
  // is_matching_head = is_matching_target and data.beacon_block_root == get_block_root_at_slot(state, data.slot)
  //
  // is_matching_source MUST be true for the attestation to be included in a block
  //
  // timely_source = is_matching_source and inclusion_delay <= integer_squareroot(SLOTS_PER_EPOCH):
  // timely_target = is_matching_target and inclusion_delay <= SLOTS_PER_EPOCH:
  // timely_head = is_matching_head and inclusion_delay == MIN_ATTESTATION_INCLUSION_DELAY:

  if (flags.timelyHead) {
    // NOTE: If timelyHead everything else MUST be true also
    return "timely_head";
  }

  //
  else if (flags.timelyTarget) {
    // timelyHead == false, means at least one is true
    // - attestation voted incorrect head
    // - attestation was included late

    // Note: the same attestation can be included in multiple blocks. For example, block with parent A at slot N can
    // include the attestation. Then block as slot N+1 re-orgs slot N setting as parent A and includes the attestations
    // from block at slot N.
    //
    // TODO: Track block inclusions, and then check which ones are canonical

    if (!summary) {
      // In normal conditions should never happen, validator is expected to submit an attestation to the tracking node.
      // If the validator is using multiple beacon nodes as fallback, this condition may be triggered.
      return "unexpected_timely_target_without_summary";
    }

    const canonicalBlockInclusion = summary.blockInclusions.find((block) => isCanonical(rootCache, block));
    if (!canonicalBlockInclusion) {
      // Should never happen, because for a state to exist that registers a validator's participation this specific
      // beacon node must have imported a block with the attestation that caused the change in participation.
      return "unexpected_timely_target_without_canonical_inclusion";
    }

    const {votedCorrectHeadRoot, blockSlot, attestationSlot} = canonicalBlockInclusion;
    const inclusionDistance = Math.max(blockSlot - attestationSlot - MIN_ATTESTATION_INCLUSION_DELAY, 0);

    if (votedCorrectHeadRoot && inclusionDistance === 0) {
      // Should never happen, in this case timelyHead must be true
      return "unexpected_timely_head_as_timely_target";
    }

    // Why is the distance > 0?
    // - Block that should have included the attestation was missed
    // - Attestation was not included in any aggregate
    // - Attestation was sent late

    // Why is the head vote wrong?
    // - We processed a block late and voted for the parent
    // - We voted for a block that latter was missed
    // - We voted for a block that was re-org for another chain

    let out = "timely_target";

    if (!votedCorrectHeadRoot) {
      out += "_" + whyIsHeadVoteWrong(rootCache, canonicalBlockInclusion);
    }

    if (inclusionDistance > 0) {
      out += "_" + whyIsDistanceNotOk(rootCache, canonicalBlockInclusion, summary);
    }

    return out;
  }

  //
  else if (flags.timelySource) {
    // timelyTarget == false && timelySource == true means that
    // - attestation voted the wrong target but distance is <= integer_squareroot(SLOTS_PER_EPOCH)
    return "wrong_target_timely_source";
  }

  //
  else {
    // timelySource == false, either:
    // - attestation was not included in the block
    // - included in block with wrong target (very unlikely)
    // - included in block with distance > SLOTS_PER_EPOCH (very unlikely)

    // Validator failed to submit an attestation for this epoch, validator client is probably offline
    if (!summary || summary.poolSubmitDelayMinSec === null) {
      return "no_submission";
    }

    const canonicalBlockInclusion = summary.blockInclusions.find((block) => isCanonical(rootCache, block));
    if (canonicalBlockInclusion) {
      // Canonical block inclusion with no participation flags set means wrong target + late source
      return "wrong_target_late_source";
    }

    const submittedLate =
      summary.poolSubmitDelayMinSec >
      (INTERVALS_LATE_ATTESTATION_SUBMISSION * config.SECONDS_PER_SLOT) / INTERVALS_PER_SLOT;

    const aggregateInclusion = summary.aggregateInclusionDelaysSec.length > 0;

    if (submittedLate && aggregateInclusion) {
      return "late_submit";
    } else if (submittedLate && !aggregateInclusion) {
      return "late_submit_no_aggregate_inclusion";
    } else if (!submittedLate && aggregateInclusion) {
      // TODO: Why was it missed then?
      if (summary.blockInclusions.length) {
        return "block_inclusion_but_orphan";
      } else {
        return "aggregate_inclusion_but_missed";
      }
      // } else if (!submittedLate && !aggregateInclusion) {
    } else {
      // Did the node had enough peers?
      if (summary.poolSubmitSentPeers === 0) {
        return "sent_to_zero_peers";
      } else {
        return "no_aggregate_inclusion";
      }
    }
  }
}

function whyIsHeadVoteWrong(rootCache: RootHexCache, canonicalBlockInclusion: AttestationBlockInclusion): string {
  const {votedForMissedSlot, attestationSlot} = canonicalBlockInclusion;
  const canonicalAttestationSlotMissed = isMissedSlot(rootCache, attestationSlot);

  // __A_______C
  //    \_B1
  //      ^^ attestation slot
  //
  // We vote for B1, but the next proposer skips our voted block.
  // This scenario happens sometimes when blocks are published late

  // __A____________E
  //    \_B1__C__D
  //      ^^ attestation slot
  //
  // We vote for B1, and due to some issue a longer reorg happens orphaning our vote.
  // This scenario is considered in the above
  if (!votedForMissedSlot && canonicalAttestationSlotMissed) {
    // TODO: Did the block arrive late?
    return "vote_orphaned";
  }

  // __A__B1___C
  //    \_(A)
  //      ^^ attestation slot
  //
  // We vote for A assuming skip block, next proposer's view differs
  // This scenario happens sometimes when blocks are published late
  if (votedForMissedSlot && !canonicalAttestationSlotMissed) {
    // TODO: Did the block arrive late?
    return "wrong_skip_vote";
  }

  // __A__B2___C
  //    \_B1
  //      ^^ attestation slot
  //
  // We vote for B1, but the next proposer continues the chain on a competing block
  // This scenario is unlikely to happen in short re-orgs given no slashings, won't consider.
  //
  // __A____B_______C
  //    \    \_(B)
  //     \_(A)_(A)
  //
  // Vote for different heads on skipped slot
  else {
    return "wrong_head_vote";
  }
}

function whyIsDistanceNotOk(
  rootCache: RootHexCache,
  canonicalBlockInclusion: AttestationBlockInclusion,
  summary: AttestationSummary
): string {
  // If the attestation is not included in any aggregate it's likely because it was sent late.
  if (summary.aggregateInclusionDelaysSec.length === 0) {
    return "no_aggregate_inclusion";
  }

  // If the next slot of an attestation is missed, distance will be > 0 even if everything else was timely
  if (isMissedSlot(rootCache, canonicalBlockInclusion.attestationSlot + 1)) {
    return "next_slot_missed";
  }

  //
  else {
    return "late_unknown";
  }
}

/** Returns true if the state's root record includes `block` */
function isCanonical(rootCache: RootHexCache, block: AttestationBlockInclusion): boolean {
  return rootCache.getBlockRootAtSlot(block.blockSlot) === block.blockRoot;
}

/** Returns true if root at slot is the same at slot - 1 == there was no new block at slot */
function isMissedSlot(rootCache: RootHexCache, slot: Slot): boolean {
  return slot > 0 && rootCache.getBlockRootAtSlot(slot) === rootCache.getBlockRootAtSlot(slot - 1);
}

function renderBlockProposalSummary(
  config: ChainConfig,
  rootCache: RootHexCache,
  summary: EpochSummary | undefined,
  proposalSlot: Slot
): string {
  const proposal = summary?.blockProposals.find((proposal) => proposal.blockSlot === proposalSlot);
  if (!proposal) {
    return "not_submitted";
  }

  if (rootCache.getBlockRootAtSlot(proposalSlot) === proposal.blockRoot) {
    // Canonical state includes our block
    return "canonical";
  }

  let out = "orphaned";

  if (isMissedSlot(rootCache, proposalSlot)) {
    out += "_missed";
  }

  if (
    proposal.poolSubmitDelaySec !== null &&
    proposal.poolSubmitDelaySec > (INTERVALS_LATE_BLOCK_SUBMISSION * config.SECONDS_PER_SLOT) / INTERVALS_PER_SLOT
  ) {
    out += "_late";
  }

  return out;
}

/**
 * Cache to prevent accessing the state tree to fetch block roots repeteadly.
 * In normal network conditions the same root is read multiple times, specially the target.
 */
export class RootHexCache {
  private readonly blockRootSlotCache = new Map<Slot, RootHex>();

  constructor(private readonly state: CachedBeaconStateAllForks) {}

  getBlockRootAtSlot(slot: Slot): RootHex {
    let root = this.blockRootSlotCache.get(slot);
    if (!root) {
      root = toHex(getBlockRootAtSlot(this.state, slot));
      this.blockRootSlotCache.set(slot, root);
    }
    return root;
  }
}
