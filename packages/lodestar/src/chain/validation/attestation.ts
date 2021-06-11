import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {ssz} from "@chainsafe/lodestar-types";
import {CachedBeaconState, computeEpochAtSlot} from "@chainsafe/lodestar-beacon-state-transition";
import {allForks, phase0} from "@chainsafe/lodestar-beacon-state-transition";
import {IBeaconDb} from "../../db";
import {IAttestationJob, IBeaconChain} from "..";
import {AttestationError, AttestationErrorCode} from "../errors";
import {ATTESTATION_PROPAGATION_SLOT_RANGE} from "../../constants";

export async function validateGossipAttestation(
  config: IBeaconConfig,
  chain: IBeaconChain,
  db: IBeaconDb,
  attestationJob: IAttestationJob,
  subnet: number
): Promise<phase0.IndexedAttestation> {
  const attestation = attestationJob.attestation;
  const numBits = getAttestationAttesterCount(attestation);
  if (numBits !== 1) {
    throw new AttestationError({
      code: AttestationErrorCode.NOT_EXACTLY_ONE_AGGREGATION_BIT_SET,
      numBits,
      job: attestationJob,
    });
  }

  const latestPermissibleSlot = chain.clock.currentSlot;
  const earliestPermissibleSlot = chain.clock.currentSlot - ATTESTATION_PROPAGATION_SLOT_RANGE;
  const attestationSlot = attestation.data.slot;
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
      latestPermissibleSlot,
      attestationSlot,
      job: attestationJob,
    });
  }

  // no other validator attestation for same target epoch has been seen
  if (db.seenAttestationCache.hasCommitteeAttestation(attestation)) {
    throw new AttestationError({
      code: AttestationErrorCode.ATTESTATION_ALREADY_KNOWN,
      root: ssz.phase0.Attestation.hashTreeRoot(attestation),
      job: attestationJob,
    });
  }

  // No need to check if `attestation.data.beaconBlockRoot` is a badBlock
  // If it is, the ForkChoice won't know about it so the `chain.forkChoice.hasBlock` is sufficient

  if (!chain.forkChoice.hasBlock(attestation.data.beaconBlockRoot)) {
    throw new AttestationError({
      code: AttestationErrorCode.UNKNOWN_BEACON_BLOCK_ROOT,
      beaconBlockRoot: attestation.data.beaconBlockRoot as Uint8Array,
      job: attestationJob,
    });
  }

  let attestationTargetState: CachedBeaconState<allForks.BeaconState>;
  try {
    attestationTargetState = await chain.regen.getCheckpointState(attestation.data.target);
  } catch (e) {
    throw new AttestationError({
      code: AttestationErrorCode.MISSING_ATTESTATION_TARGET_STATE,
      error: e as Error,
      job: attestationJob,
    });
  }

  const expectedSubnet = allForks.computeSubnetForAttestation(attestationTargetState, attestation);
  if (subnet !== expectedSubnet) {
    throw new AttestationError({
      code: AttestationErrorCode.INVALID_SUBNET_ID,
      received: subnet,
      expected: expectedSubnet,
      job: attestationJob,
    });
  }

  const indexedAttestation = attestationTargetState.getIndexedAttestation(attestation);

  // Do verify signature
  if (!attestationJob.validSignature) {
    const signatureSet = allForks.getIndexedAttestationSignatureSet(attestationTargetState, indexedAttestation);
    if (!(await chain.bls.verifySignatureSets([signatureSet]))) {
      throw new AttestationError({
        code: AttestationErrorCode.INVALID_SIGNATURE,
        job: attestationJob,
      });
    }
  }

  // verifySignature = false, verified above
  if (!phase0.isValidIndexedAttestation(attestationTargetState, indexedAttestation, false)) {
    throw new AttestationError({
      code: AttestationErrorCode.INVALID_INDEXED_ATTESTATION,
      job: attestationJob,
    });
  }

  if (!ssz.Epoch.equals(attestation.data.target.epoch, computeEpochAtSlot(attestationSlot))) {
    throw new AttestationError({
      code: AttestationErrorCode.BAD_TARGET_EPOCH,
      job: attestationJob,
    });
  }

  try {
    if (!isCommitteeIndexWithinRange(attestationTargetState, attestation.data)) {
      throw new AttestationError({
        code: AttestationErrorCode.COMMITTEE_INDEX_OUT_OF_RANGE,
        index: attestation.data.index,
        job: attestationJob,
      });
    }
  } catch (error) {
    throw new AttestationError({
      code: AttestationErrorCode.COMMITTEE_INDEX_OUT_OF_RANGE,
      index: attestation.data.index,
      job: attestationJob,
    });
  }

  if (!doAggregationBitsMatchCommitteeSize(attestationTargetState, attestation)) {
    throw new AttestationError({
      code: AttestationErrorCode.WRONG_NUMBER_OF_AGGREGATION_BITS,
      job: attestationJob,
    });
  }

  if (!chain.forkChoice.isDescendant(attestation.data.target.root, attestation.data.beaconBlockRoot)) {
    throw new AttestationError({
      code: AttestationErrorCode.TARGET_BLOCK_NOT_AN_ANCESTOR_OF_LMD_BLOCK,
      job: attestationJob,
    });
  }

  if (!chain.forkChoice.isDescendantOfFinalized(attestation.data.beaconBlockRoot)) {
    throw new AttestationError({
      code: AttestationErrorCode.FINALIZED_CHECKPOINT_NOT_AN_ANCESTOR_OF_ROOT,
      job: attestationJob,
    });
  }
  db.seenAttestationCache.addCommitteeAttestation(attestation);

  return indexedAttestation;
}

export function getAttestationAttesterCount(attestation: phase0.Attestation): number {
  return Array.from(attestation.aggregationBits).filter((bit) => !!bit).length;
}

export function isCommitteeIndexWithinRange(
  epochCtx: allForks.EpochContext,
  attestationData: phase0.AttestationData
): boolean {
  return attestationData.index < epochCtx.getCommitteeCountAtSlot(attestationData.slot);
}

export function doAggregationBitsMatchCommitteeSize(
  epochCtx: allForks.EpochContext,
  attestation: phase0.Attestation
): boolean {
  return (
    attestation.aggregationBits.length ===
    epochCtx.getBeaconCommittee(attestation.data.slot, attestation.data.index).length
  );
}
