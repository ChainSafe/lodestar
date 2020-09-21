import {ExtendedValidatorResult} from "../constants";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {ILogger} from "@chainsafe/lodestar-utils";
import {Attestation} from "@chainsafe/lodestar-types";
import {toHexString} from "@chainsafe/ssz";
import {IBeaconDb} from "../../../db/api";
import {IBeaconChain} from "../../../chain";
import {getAttestationPreState, getBlockStateContext} from "../utils";
import {computeSubnetForAttestation} from "@chainsafe/lodestar-beacon-state-transition/lib/fast/util/attestation";
// eslint-disable-next-line max-len
import {isValidIndexedAttestation} from "@chainsafe/lodestar-beacon-state-transition/lib/fast/block/isValidIndexedAttestation";
import {hasValidAttestationSlot} from "./utils/hasValidAttestationSlot";

export async function validateGossipAttestation(
  config: IBeaconConfig,
  chain: IBeaconChain,
  db: IBeaconDb,
  logger: ILogger,
  attestation: Attestation,
  subnet: number
): Promise<ExtendedValidatorResult> {
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
    logger.warn("Rejected gossip committee attestation", {
      reason: "not unaggregated attesation",
      aggregationBits: JSON.stringify(attestation.aggregationBits),
      ...attestationLogContext,
    });
    return ExtendedValidatorResult.reject;
  }

  if (await isAttestingToInValidBlock(db, attestation)) {
    logger.warn("Rejected gossip committee attestation", {
      reason: "attestation block is invalid",
      ...attestationLogContext,
    });
    return ExtendedValidatorResult.reject;
  }

  if (!hasValidAttestationSlot(config, chain.getGenesisTime(), attestation.data.slot)) {
    logger.warn("Ignored gossip committee attestation", {reason: "Invalid slot time", ...attestationLogContext});
    //attestation might be valid later so passing to attestation pool
    await chain.receiveAttestation(attestation);
    return ExtendedValidatorResult.ignore;
  }

  //no other validator attestation for same target epoch has been seen
  if (await db.seenAttestationCache.hasCommitteeAttestation(attestation)) {
    return ExtendedValidatorResult.ignore;
  }

  const attestationStateContext = await getBlockStateContext(chain.forkChoice, db, attestation.data.beaconBlockRoot);
  if (!attestationStateContext) {
    logger.warn("Ignored gossip committee attestation", {
      reason: "missing attestation state/block",
      ...attestationLogContext,
    });
    //attestation might be valid after we receive block
    await chain.receiveAttestation(attestation);
    return ExtendedValidatorResult.ignore;
  }
  const attestationPreStateContext = await getAttestationPreState(config, chain, db, attestation.data.target);
  if (!attestationPreStateContext) {
    logger.warn("Ignored gossip committee attestation", {
      reason: "missing attestation prestate",
      ...attestationLogContext,
    });
    //attestation might be valid after we receive block
    await chain.receiveAttestation(attestation);
    return ExtendedValidatorResult.ignore;
  }

  const expectedSubnet = computeSubnetForAttestation(config, attestationPreStateContext.epochCtx, attestation);
  if (subnet !== expectedSubnet) {
    logger.warn("Rejected gossip committee attestation", {
      reason: "wrong subnet",
      subnet,
      expectedSubnet,
      ...attestationLogContext,
    });
    return ExtendedValidatorResult.reject;
  }
  if (
    !isValidIndexedAttestation(
      attestationPreStateContext.epochCtx,
      attestationPreStateContext.state,
      attestationPreStateContext.epochCtx.getIndexedAttestation(attestation),
      true
    )
  ) {
    logger.warn("Rejected gossip committee attestation", {
      reason: "invalid indexed attestation",
      ...attestationLogContext,
    });
    return ExtendedValidatorResult.reject;
  }
  await db.seenAttestationCache.addCommitteeAttestation(attestation);
  logger.profile("gossipAttestationValidation");
  logger.info("Received valid committee attestation", attestationLogContext);
  return ExtendedValidatorResult.accept;
}

export async function isAttestingToInValidBlock(db: IBeaconDb, attestation: Attestation): Promise<boolean> {
  const blockRoot = attestation.data.beaconBlockRoot.valueOf() as Uint8Array;
  //TODO: check if source and target blocks are not in bad block repository
  return await db.badBlock.has(blockRoot);
}

export function isUnaggregatedAttestation(attestation: Attestation): boolean {
  return Array.from(attestation.aggregationBits).filter((bit) => !!bit).length === 1;
}
