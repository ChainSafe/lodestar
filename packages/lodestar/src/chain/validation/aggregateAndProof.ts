import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {ValidatorIndex} from "@chainsafe/lodestar-types";
import {IAttestationJob, IBeaconChain} from "..";
import {IBeaconDb} from "../../db";
import {
  phase0,
  allForks,
  computeEpochAtSlot,
  isAggregatorFromCommitteeLength,
} from "@chainsafe/lodestar-beacon-state-transition";
import {getSelectionProofSignatureSet, getAggregateAndProofSignatureSet} from "./signatureSets";
import {AttestationGossipError, AttestationErrorCode, GossipAction} from "../errors";
import {ATTESTATION_PROPAGATION_SLOT_RANGE} from "../../constants";

export async function validateGossipAggregateAndProof(
  config: IBeaconConfig,
  chain: IBeaconChain,
  db: IBeaconDb,
  signedAggregateAndProof: phase0.SignedAggregateAndProof,
  attestationJob: IAttestationJob
): Promise<void> {
  const aggregateAndProof = signedAggregateAndProof.message;
  const aggregate = aggregateAndProof.aggregate;

  // the target state, advanced to the attestation slot
  const attestationTargetState = await chain.regen.getCheckpointState(aggregate.data.target).catch((e) => {
    throw new AttestationGossipError(GossipAction.IGNORE, {
      code: AttestationErrorCode.MISSING_ATTESTATION_TARGET_STATE,
      error: e as Error,
      job: attestationJob,
    });
  });

  // Note: no need to verify isValidIndexedAttestation(), we just created the indexedAttestation here
  const indexedAttestation = attestationTargetState.getIndexedAttestation(aggregate);

  // [IGNORE] aggregate.data.slot is within the last ATTESTATION_PROPAGATION_SLOT_RANGE slots
  // (with a MAXIMUM_GOSSIP_CLOCK_DISPARITY allowance)
  // -- i.e. aggregate.data.slot + ATTESTATION_PROPAGATION_SLOT_RANGE >= current_slot >= aggregate.data.slot
  // (a client MAY queue future aggregates for processing at the appropriate slot).
  const latestPermissibleSlot = chain.clock.currentSlot;
  const earliestPermissibleSlot = chain.clock.currentSlot - ATTESTATION_PROPAGATION_SLOT_RANGE;
  const attestationSlot = aggregate.data.slot;
  if (attestationSlot < earliestPermissibleSlot) {
    throw new AttestationGossipError(GossipAction.IGNORE, {
      code: AttestationErrorCode.PAST_SLOT,
      earliestPermissibleSlot,
      attestationSlot,
      job: attestationJob,
    });
  }
  if (attestationSlot > latestPermissibleSlot) {
    throw new AttestationGossipError(GossipAction.IGNORE, {
      code: AttestationErrorCode.FUTURE_SLOT,
      attestationSlot,
      latestPermissibleSlot,
      job: attestationJob,
    });
  }

  // [REJECT] The aggregate attestation's epoch matches its target
  // -- i.e. aggregate.data.target.epoch == compute_epoch_at_slot(aggregate.data.slot)

  // [IGNORE] The aggregate is the first valid aggregate received for the aggregator with
  // index aggregate_and_proof.aggregator_index for the epoch aggregate.data.target.epoch.
  if (db.seenAttestationCache.hasAggregateAndProof(aggregateAndProof)) {
    throw new AttestationGossipError(GossipAction.REJECT, {
      code: AttestationErrorCode.AGGREGATE_ALREADY_KNOWN,
      job: attestationJob,
    });
  }

  // [REJECT] The attestation has participants -- that is,
  // len(get_attesting_indices(state, aggregate.data, aggregate.aggregation_bits)) >= 1.
  if (indexedAttestation.attestingIndices.length < 1) {
    // missing attestation participants
    throw new AttestationGossipError(GossipAction.REJECT, {
      code: AttestationErrorCode.WRONG_NUMBER_OF_AGGREGATION_BITS,
      job: attestationJob,
    });
  }

  let committee: ValidatorIndex[];
  try {
    committee = attestationTargetState.getBeaconCommittee(aggregate.data.slot, aggregate.data.index);
  } catch (error) {
    throw new AttestationGossipError(GossipAction.REJECT, {
      code: AttestationErrorCode.AGGREGATOR_NOT_IN_COMMITTEE,
      job: attestationJob,
    });
  }

  // [REJECT] aggregate_and_proof.selection_proof selects the validator as an aggregator for the slot
  // -- i.e. is_aggregator(state, aggregate.data.slot, aggregate.data.index, aggregate_and_proof.selection_proof) returns True.
  if (!isAggregatorFromCommitteeLength(config, committee.length, aggregateAndProof.selectionProof)) {
    throw new AttestationGossipError(GossipAction.REJECT, {
      code: AttestationErrorCode.INVALID_AGGREGATOR,
      job: attestationJob,
    });
  }

  // [REJECT] The aggregator's validator index is within the committee
  // -- i.e. aggregate_and_proof.aggregator_index in get_beacon_committee(state, aggregate.data.slot, aggregate.data.index).
  if (!committee.includes(aggregateAndProof.aggregatorIndex)) {
    throw new AttestationGossipError(GossipAction.REJECT, {
      code: AttestationErrorCode.AGGREGATOR_NOT_IN_COMMITTEE,
      job: attestationJob,
    });
  }

  // [IGNORE] The block being voted for (aggregate.data.beacon_block_root) has been seen
  // (via both gossip and non-gossip sources) (a client MAY queue aggregates for processing once block is retrieved).

  // [REJECT] The block being voted for (aggregate.data.beacon_block_root) passes validation.
  if (await db.badBlock.has(aggregate.data.beaconBlockRoot.valueOf() as Uint8Array)) {
    throw new AttestationGossipError(GossipAction.REJECT, {
      code: AttestationErrorCode.KNOWN_BAD_BLOCK,
      job: attestationJob,
    });
  }

  // [REJECT] The current finalized_checkpoint is an ancestor of the block defined by aggregate.data.beacon_block_root
  // -- i.e. get_ancestor(store, aggregate.data.beacon_block_root, compute_start_slot_at_epoch(store.finalized_checkpoint.epoch)) == store.finalized_checkpoint.root

  // [REJECT] The aggregate_and_proof.selection_proof is a valid signature of the aggregate.data.slot
  // by the validator with index aggregate_and_proof.aggregator_index.
  // [REJECT] The aggregator signature, signed_aggregate_and_proof.signature, is valid.
  // [REJECT] The signature of aggregate is valid.
  const slot = aggregate.data.slot;
  const epoch = computeEpochAtSlot(config, slot);
  const aggregator = attestationTargetState.index2pubkey[aggregateAndProof.aggregatorIndex];
  const signatureSets = [
    getSelectionProofSignatureSet(config, attestationTargetState, slot, aggregator, signedAggregateAndProof),
    getAggregateAndProofSignatureSet(config, attestationTargetState, epoch, aggregator, signedAggregateAndProof),
    allForks.getIndexedAttestationSignatureSet(attestationTargetState, indexedAttestation),
  ];
  if (!(await chain.bls.verifySignatureSets(signatureSets))) {
    throw new AttestationGossipError(GossipAction.REJECT, {
      code: AttestationErrorCode.INVALID_SIGNATURE,
      job: attestationJob,
    });
  }

  // TODO: once we have pool, check if aggregate block is seen and has target as ancestor
}
