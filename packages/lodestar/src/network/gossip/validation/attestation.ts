import {ExtendedValidatorResult} from "../constants";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {ILogger} from "@chainsafe/lodestar-utils";
import {Attestation, AttestationData} from "@chainsafe/lodestar-types";
import {toHexString} from "@chainsafe/ssz";
import {IBeaconDb} from "../../../db/api";
import {IAttestationJob, IBeaconChain} from "../../../chain";
import {computeSubnetForAttestation} from "@chainsafe/lodestar-beacon-state-transition/lib/fast/util/attestation";
import {isValidIndexedAttestation} from "@chainsafe/lodestar-beacon-state-transition/lib/fast/block/isValidIndexedAttestation";
import {hasValidAttestationSlot} from "./utils/hasValidAttestationSlot";
import {ITreeStateContext} from "../../../db/api/beacon/stateContextCache";
import {computeEpochAtSlot} from "@chainsafe/lodestar-beacon-state-transition";
import {EpochContext} from "@chainsafe/lodestar-beacon-state-transition";
import {AttestationError, AttestationErrorCode} from "../../../chain/errors";

export async function validateGossipAttestation(
  config: IBeaconConfig,
  chain: IBeaconChain,
  db: IBeaconDb,
  logger: ILogger,
  attestationJob: IAttestationJob,
  subnet: number
): Promise<ExtendedValidatorResult> {
  const attestation = attestationJob.attestation;
  logger.profile("gossipAttestationValidation");
  const attestationRoot = config.types.Attestation.hashTreeRoot(attestation);
  const attestationLogContext = {
    attestationSlot: attestation.data.slot,
    attestationBlockRoot: toHexString(attestation.data.beaconBlockRoot),
    attestationRoot: toHexString(attestationRoot),
    subnet,
  };
  logger.verbose("Started gossip committee attestation validation", attestationLogContext);

  if (!isUnaggregatedAttestation(attestation)) {
    throw new AttestationError({
      code: AttestationErrorCode.ERR_NOT_EXACTLY_ONE_AGGREGATION_BIT_SET,
      // aggregationBits: JSON.stringify(attestation.aggregationBits),
      numBits: Array.from(attestation.aggregationBits).filter((bit) => !!bit).length,
      ...attestationLogContext,
      job: attestationJob,
    });
  }

  if (await isAttestingToInValidBlock(db, attestation)) {
    throw new AttestationError({
      code: AttestationErrorCode.ERR_KNOWN_BAD_BLOCK,
      ...attestationLogContext,
      job: attestationJob,
    });
  }

  if (!hasValidAttestationSlot(config, chain.clock.currentSlot, attestation.data.slot)) {
    // attestation might be valid later so passing to attestation pool
    await chain.receiveAttestation(attestation);

    throw new AttestationError({
      code: AttestationErrorCode.ERR_SLOT_OUT_OF_RANGE,
      ...attestationLogContext,
      job: attestationJob,
    });
  }

  // no other validator attestation for same target epoch has been seen
  if (await db.seenAttestationCache.hasCommitteeAttestation(attestation)) {
    throw new AttestationError({
      code: AttestationErrorCode.ERR_ATTESTATION_ALREADY_KNOWN,
      ...attestationLogContext,
      root: attestation.data.beaconBlockRoot as Uint8Array,
      job: attestationJob,
    });
  }

  if (await db.badBlock.has(attestation.data.beaconBlockRoot.valueOf() as Uint8Array)) {
    throw new AttestationError({
      code: AttestationErrorCode.ERR_KNOWN_BAD_BLOCK,
      ...attestationLogContext,
      job: attestationJob,
    });
  }

  if (!chain.forkChoice.hasBlock(attestation.data.beaconBlockRoot)) {
    // attestation might be valid after we receive block
    await chain.receiveAttestation(attestation);

    throw new AttestationError({
      code: AttestationErrorCode.ERR_UNKNOWN_HEAD_BLOCK,
      beaconBlockRoot: attestation.data.beaconBlockRoot as Uint8Array,
      ...attestationLogContext,
      job: attestationJob,
    });
  }

  let attestationPreStateContext;
  try {
    attestationPreStateContext = await chain.regen.getCheckpointState(attestation.data.target);
  } catch (e) {
    // attestation might be valid after we receive block
    await chain.receiveAttestation(attestation);

    throw new AttestationError({
      code: AttestationErrorCode.ERR_MISSING_ATTESTATION_PRESTATE,
      ...attestationLogContext,
      job: attestationJob,
    });
  }

  const expectedSubnet = computeSubnetForAttestation(config, attestationPreStateContext.epochCtx, attestation);
  if (subnet !== expectedSubnet) {
    throw new AttestationError({
      code: AttestationErrorCode.ERR_INVALID_SUBNET_ID,
      received: subnet,
      expected: expectedSubnet,
      ...attestationLogContext,
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
      code: AttestationErrorCode.ERR_INVALID_INDEXED_ATTESTATION,
      ...attestationLogContext,
      job: attestationJob,
    });
  }
  if (!doesEpochSlotMatchTarget(config, attestation.data)) {
    throw new AttestationError({
      code: AttestationErrorCode.ERR_BAD_TARGET_EPOCH,
      ...attestationLogContext,
      job: attestationJob,
    });
  }
  try {
    if (!isCommitteeIndexWithinRange(attestationPreStateContext.epochCtx, attestation.data)) {
      throw new AttestationError({
        code: AttestationErrorCode.ERR_COMMITTEE_INDEX_OUT_OF_RANGE,
        index: attestation.data.index,
        ...attestationLogContext,
        job: attestationJob,
      });
    }
  } catch (error) {
    logger.warn(error);
    throw new AttestationError({
      code: AttestationErrorCode.ERR_COMMITTEE_INDEX_OUT_OF_RANGE,
      index: attestation.data.index,
      ...attestationLogContext,
      job: attestationJob,
    });
  }
  if (!doAggregationBitsMatchCommitteeSize(attestationPreStateContext, attestation)) {
    throw new AttestationError({
      code: AttestationErrorCode.ERR_WRONG_NUMBER_OF_AGGREGATION_BITS,
      ...attestationLogContext,
      job: attestationJob,
    });
  }
  if (!chain.forkChoice.isDescendant(attestation.data.target.root, attestation.data.beaconBlockRoot)) {
    throw new AttestationError({
      code: AttestationErrorCode.ERR_TARGET_BLOCK_NOT_AN_ANCESTOR_OF_LMD_BLOCK,
      ...attestationLogContext,
      job: attestationJob,
    });
  }
  if (!chain.forkChoice.isDescendantOfFinalized(attestation.data.beaconBlockRoot)) {
    throw new AttestationError({
      code: AttestationErrorCode.ERR_FINALIZED_CHECKPOINT_NOT_AN_ANCESTOR_OF_ROOT,
      ...attestationLogContext,
      job: attestationJob,
    });
  }
  await db.seenAttestationCache.addCommitteeAttestation(attestation);
  logger.profile("gossipAttestationValidation");
  logger.info("Received valid committee attestation", attestationLogContext);
  return ExtendedValidatorResult.accept;
}

export async function isAttestingToInValidBlock(db: IBeaconDb, attestation: Attestation): Promise<boolean> {
  const blockRoot = attestation.data.beaconBlockRoot.valueOf() as Uint8Array;
  // TODO: check if source and target blocks are not in bad block repository
  return await db.badBlock.has(blockRoot);
}

export function isUnaggregatedAttestation(attestation: Attestation): boolean {
  return Array.from(attestation.aggregationBits).filter((bit) => !!bit).length === 1;
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

export function doesEpochSlotMatchTarget(config: IBeaconConfig, attestationData: AttestationData): boolean {
  return config.types.Epoch.equals(attestationData.target.epoch, computeEpochAtSlot(config, attestationData.slot));
}
