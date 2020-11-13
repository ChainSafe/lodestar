import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {IAttestationJob, IBeaconChain} from "..";
import {IBeaconDb} from "../../db/api";
import {Attestation, SignedAggregateAndProof} from "@chainsafe/lodestar-types";
import {computeEpochAtSlot, isAggregatorFromCommitteeLength} from "@chainsafe/lodestar-beacon-state-transition";
import {isAttestingToInValidBlock} from "./attestation";
import {isValidIndexedAttestation} from "@chainsafe/lodestar-beacon-state-transition/lib/fast/block/isValidIndexedAttestation";
import {isValidAggregateAndProofSignature, isValidSelectionProofSignature} from "./utils";
import {AttestationError, AttestationErrorCode} from "../errors";
import {ATTESTATION_PROPAGATION_SLOT_RANGE} from "../../constants";

export async function validateGossipAggregateAndProof(
  config: IBeaconConfig,
  chain: IBeaconChain,
  db: IBeaconDb,
  signedAggregateAndProof: SignedAggregateAndProof,
  attestationJob: IAttestationJob
): Promise<void> {
  const aggregateAndProof = signedAggregateAndProof.message;
  const aggregate = aggregateAndProof.aggregate;

  const latestPermissibleSlot = chain.clock.currentSlot;
  const earliestPermissibleSlot = chain.clock.currentSlot - ATTESTATION_PROPAGATION_SLOT_RANGE;
  const attestationSlot = aggregate.data.slot;
  if (attestationSlot < earliestPermissibleSlot) {
    throw new AttestationError({
      code: AttestationErrorCode.ERR_PAST_SLOT,
      earliestPermissibleSlot,
      attestationSlot,
      job: attestationJob,
    });
  }
  if (attestationSlot > latestPermissibleSlot) {
    throw new AttestationError({
      code: AttestationErrorCode.ERR_FUTURE_SLOT,
      attestationSlot,
      latestPermissibleSlot,
      job: attestationJob,
    });
  }
  if (await db.seenAttestationCache.hasAggregateAndProof(aggregateAndProof)) {
    throw new AttestationError({
      code: AttestationErrorCode.ERR_AGGREGATE_ALREADY_KNOWN,
      job: attestationJob,
    });
  }
  if (!hasAttestationParticipants(aggregate)) {
    // missing attestation participants
    throw new AttestationError({
      code: AttestationErrorCode.ERR_WRONG_NUMBER_OF_AGGREGATION_BITS,
      job: attestationJob,
    });
  }
  if (await isAttestingToInValidBlock(db, aggregate)) {
    throw new AttestationError({
      code: AttestationErrorCode.ERR_KNOWN_BAD_BLOCK,
      job: attestationJob,
    });
  }

  // TODO: check pool of aggregates if already seen (not a dos vector check)

  await validateAggregateAttestation(config, chain, signedAggregateAndProof, attestationJob);
}

export function hasAttestationParticipants(attestation: Attestation): boolean {
  return Array.from(attestation.aggregationBits).filter((bit) => !!bit).length >= 1;
}

export async function validateAggregateAttestation(
  config: IBeaconConfig,
  chain: IBeaconChain,
  aggregateAndProof: SignedAggregateAndProof,
  attestationJob: IAttestationJob
): Promise<void> {
  const attestation = aggregateAndProof.message.aggregate;
  let attestationPreState;
  try {
    // the target state, advanced to the attestation slot
    attestationPreState = await chain.regen.getBlockSlotState(attestation.data.target.root, attestation.data.slot);
  } catch (e) {
    throw new AttestationError({
      code: AttestationErrorCode.ERR_MISSING_ATTESTATION_PRESTATE,
      job: attestationJob,
    });
  }

  const {state, epochCtx} = attestationPreState;
  let committee;
  try {
    committee = epochCtx.getBeaconCommittee(attestation.data.slot, attestation.data.index);
  } catch (error) {
    throw new AttestationError({
      code: AttestationErrorCode.ERR_AGGREGATOR_NOT_IN_COMMITTEE,
      job: attestationJob,
    });
  }
  if (!committee.includes(aggregateAndProof.message.aggregatorIndex)) {
    throw new AttestationError({
      code: AttestationErrorCode.ERR_AGGREGATOR_NOT_IN_COMMITTEE,
      job: attestationJob,
    });
  }
  if (!isAggregatorFromCommitteeLength(config, committee.length, aggregateAndProof.message.selectionProof)) {
    throw new AttestationError({
      code: AttestationErrorCode.ERR_INVALID_AGGREGATOR,
      job: attestationJob,
    });
  }
  const aggregator = epochCtx.index2pubkey[aggregateAndProof.message.aggregatorIndex];
  if (
    !isValidSelectionProofSignature(
      config,
      state,
      attestation.data.slot,
      aggregator,
      aggregateAndProof.message.selectionProof
    )
  ) {
    throw new AttestationError({
      code: AttestationErrorCode.ERR_INVALID_SELECTION_PROOF,
      job: attestationJob,
    });
  }
  if (
    !isValidAggregateAndProofSignature(
      config,
      state,
      computeEpochAtSlot(config, attestation.data.slot),
      aggregator,
      aggregateAndProof
    )
  ) {
    throw new AttestationError({
      code: AttestationErrorCode.ERR_INVALID_SIGNATURE,
      job: attestationJob,
    });
  }

  // TODO: once we have pool, check if aggregate block is seen and has target as ancestor

  if (!isValidIndexedAttestation(epochCtx, state, epochCtx.getIndexedAttestation(attestation))) {
    throw new AttestationError({
      code: AttestationErrorCode.ERR_INVALID_SIGNATURE,
      job: attestationJob,
    });
  }
}
