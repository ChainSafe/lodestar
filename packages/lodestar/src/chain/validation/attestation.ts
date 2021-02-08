import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {Attestation, AttestationData} from "@chainsafe/lodestar-types";
import {IBeaconDb} from "../../db/api";
import {IAttestationJob, IBeaconChain} from "..";
import {computeSubnetForAttestation} from "@chainsafe/lodestar-beacon-state-transition/lib/fast/util/attestation";
import {isValidIndexedAttestation} from "@chainsafe/lodestar-beacon-state-transition/lib/fast/block/isValidIndexedAttestation";
import {ITreeStateContext} from "../interface";
import {computeEpochAtSlot} from "@chainsafe/lodestar-beacon-state-transition";
import {EpochContext} from "@chainsafe/lodestar-beacon-state-transition";
import {AttestationError, AttestationErrorCode} from "../errors";
import {ATTESTATION_PROPAGATION_SLOT_RANGE} from "../../constants";

export async function validateGossipAttestation(
  config: IBeaconConfig,
  chain: IBeaconChain,
  db: IBeaconDb,
  attestationJob: IAttestationJob,
  subnet: number
): Promise<void> {
  const attestation = attestationJob.attestation;
  const numBits = getAttestationAttesterCount(attestation);
  if (numBits !== 1) {
    throw new AttestationError({
      code: AttestationErrorCode.NOT_EXACTLY_ONE_AGGREGATION_BIT_SET,
      numBits,
      job: attestationJob,
    });
  }
  if (await isAttestingToInValidBlock(db, attestation)) {
    throw new AttestationError({
      code: AttestationErrorCode.KNOWN_BAD_BLOCK,
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
  if (await db.seenAttestationCache.hasCommitteeAttestation(attestation)) {
    throw new AttestationError({
      code: AttestationErrorCode.ATTESTATION_ALREADY_KNOWN,
      root: config.types.Attestation.hashTreeRoot(attestation),
      job: attestationJob,
    });
  }

  if (await db.badBlock.has(attestation.data.beaconBlockRoot.valueOf() as Uint8Array)) {
    throw new AttestationError({
      code: AttestationErrorCode.KNOWN_BAD_BLOCK,
      job: attestationJob,
    });
  }

  if (!chain.forkChoice.hasBlock(attestation.data.beaconBlockRoot)) {
    throw new AttestationError({
      code: AttestationErrorCode.UNKNOWN_BEACON_BLOCK_ROOT,
      beaconBlockRoot: attestation.data.beaconBlockRoot as Uint8Array,
      job: attestationJob,
    });
  }

  let attestationPreStateContext;
  try {
    attestationPreStateContext = await chain.regen.getCheckpointState(attestation.data.target);
  } catch (e) {
    throw new AttestationError({
      code: AttestationErrorCode.MISSING_ATTESTATION_PRESTATE,
      job: attestationJob,
    });
  }

  const expectedSubnet = computeSubnetForAttestation(config, attestationPreStateContext.epochCtx, attestation);
  if (subnet !== expectedSubnet) {
    throw new AttestationError({
      code: AttestationErrorCode.INVALID_SUBNET_ID,
      received: subnet,
      expected: expectedSubnet,
      job: attestationJob,
    });
  }

  if (
    !isValidIndexedAttestation(
      attestationPreStateContext.epochCtx,
      attestationPreStateContext.state,
      attestationPreStateContext.epochCtx.getIndexedAttestation(attestation),
      true
    )
  ) {
    throw new AttestationError({
      code: AttestationErrorCode.INVALID_SIGNATURE,
      job: attestationJob,
    });
  }

  if (!config.types.Epoch.equals(attestation.data.target.epoch, computeEpochAtSlot(config, attestationSlot))) {
    throw new AttestationError({
      code: AttestationErrorCode.BAD_TARGET_EPOCH,
      job: attestationJob,
    });
  }

  try {
    if (!isCommitteeIndexWithinRange(attestationPreStateContext.epochCtx, attestation.data)) {
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

  if (!doAggregationBitsMatchCommitteeSize(attestationPreStateContext, attestation)) {
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
  await db.seenAttestationCache.addCommitteeAttestation(attestation);
}

export async function isAttestingToInValidBlock(db: IBeaconDb, attestation: Attestation): Promise<boolean> {
  const blockRoot = attestation.data.beaconBlockRoot.valueOf() as Uint8Array;
  // TODO: check if source and target blocks are not in bad block repository
  return await db.badBlock.has(blockRoot);
}

export function getAttestationAttesterCount(attestation: Attestation): number {
  return Array.from(attestation.aggregationBits).filter((bit) => !!bit).length;
}

export function isCommitteeIndexWithinRange(epochCtx: EpochContext, attestationData: AttestationData): boolean {
  return attestationData.index < epochCtx.getCommitteeCountAtSlot(attestationData.slot);
}

export function doAggregationBitsMatchCommitteeSize(
  attestationPreStateContext: ITreeStateContext,
  attestation: Attestation
): boolean {
  return (
    attestation.aggregationBits.length ===
    attestationPreStateContext.epochCtx.getBeaconCommittee(attestation.data.slot, attestation.data.index).length
  );
}
