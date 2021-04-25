import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {allForks, ValidatorIndex} from "@chainsafe/lodestar-types";
import {IAttestationJob, IBeaconChain} from "..";
import {IBeaconDb} from "../../db";
import {
  phase0,
  fast,
  CachedBeaconState,
  computeEpochAtSlot,
  isAggregatorFromCommitteeLength,
} from "@chainsafe/lodestar-beacon-state-transition";
import {isAttestingToInValidBlock} from "./attestation";
import {getSelectionProofSignatureSet, getAggregateAndProofSignatureSet} from "./utils";
import {AttestationError, AttestationErrorCode} from "../errors";
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

  const latestPermissibleSlot = chain.clock.currentSlot;
  const earliestPermissibleSlot = chain.clock.currentSlot - ATTESTATION_PROPAGATION_SLOT_RANGE;
  const attestationSlot = aggregate.data.slot;

  if (attestationSlot < earliestPermissibleSlot) {
    throw new AttestationError({
      code: AttestationErrorCode.PAST_SLOT,
      earliestPermissibleSlot,
      attestationSlot,
      job: attestationJob,
    });
  }

  if (attestationSlot > latestPermissibleSlot) {
    throw new AttestationError({
      code: AttestationErrorCode.FUTURE_SLOT,
      attestationSlot,
      latestPermissibleSlot,
      job: attestationJob,
    });
  }

  if (db.seenAttestationCache.hasAggregateAndProof(aggregateAndProof)) {
    throw new AttestationError({
      code: AttestationErrorCode.AGGREGATE_ALREADY_KNOWN,
      job: attestationJob,
    });
  }

  if (!hasAttestationParticipants(aggregate)) {
    // missing attestation participants
    throw new AttestationError({
      code: AttestationErrorCode.WRONG_NUMBER_OF_AGGREGATION_BITS,
      job: attestationJob,
    });
  }

  if (await isAttestingToInValidBlock(db, aggregate)) {
    throw new AttestationError({
      code: AttestationErrorCode.KNOWN_BAD_BLOCK,
      job: attestationJob,
    });
  }

  await validateAggregateAttestation(config, chain, signedAggregateAndProof, attestationJob);
}

export function hasAttestationParticipants(attestation: phase0.Attestation): boolean {
  return Array.from(attestation.aggregationBits).filter((bit) => !!bit).length >= 1;
}

export async function validateAggregateAttestation(
  config: IBeaconConfig,
  chain: IBeaconChain,
  aggregateAndProof: phase0.SignedAggregateAndProof,
  attestationJob: IAttestationJob
): Promise<void> {
  const attestation = aggregateAndProof.message.aggregate;

  let attestationTargetState: CachedBeaconState<allForks.BeaconState>;
  try {
    // the target state, advanced to the attestation slot
    attestationTargetState = await chain.regen.getCheckpointState(attestation.data.target);
  } catch (e) {
    throw new AttestationError({
      code: AttestationErrorCode.MISSING_ATTESTATION_TARGET_STATE,
      error: e as Error,
      job: attestationJob,
    });
  }

  let committee: ValidatorIndex[];
  try {
    committee = attestationTargetState.getBeaconCommittee(attestation.data.slot, attestation.data.index);
  } catch (error) {
    throw new AttestationError({
      code: AttestationErrorCode.AGGREGATOR_NOT_IN_COMMITTEE,
      job: attestationJob,
    });
  }

  if (!committee.includes(aggregateAndProof.message.aggregatorIndex)) {
    throw new AttestationError({
      code: AttestationErrorCode.AGGREGATOR_NOT_IN_COMMITTEE,
      job: attestationJob,
    });
  }

  if (!isAggregatorFromCommitteeLength(config, committee.length, aggregateAndProof.message.selectionProof)) {
    throw new AttestationError({
      code: AttestationErrorCode.INVALID_AGGREGATOR,
      job: attestationJob,
    });
  }

  const slot = attestation.data.slot;
  const epoch = computeEpochAtSlot(config, slot);
  const indexedAttestation = attestationTargetState.getIndexedAttestation(attestation);
  const aggregator = attestationTargetState.index2pubkey[aggregateAndProof.message.aggregatorIndex];

  const signatureSets = [
    getSelectionProofSignatureSet(config, attestationTargetState, slot, aggregator, aggregateAndProof),
    getAggregateAndProofSignatureSet(config, attestationTargetState, epoch, aggregator, aggregateAndProof),
    fast.getIndexedAttestationSignatureSet(attestationTargetState, indexedAttestation),
  ];

  if (!(await chain.bls.verifySignatureSetsBatch(signatureSets))) {
    throw new AttestationError({
      code: AttestationErrorCode.INVALID_SIGNATURE,
      job: attestationJob,
    });
  }

  // TODO: once we have pool, check if aggregate block is seen and has target as ancestor

  // verifySignature = false, verified in batch above
  if (!phase0.fast.isValidIndexedAttestation(attestationTargetState, indexedAttestation, false)) {
    throw new AttestationError({
      code: AttestationErrorCode.INVALID_INDEXED_ATTESTATION,
      job: attestationJob,
    });
  }
}
