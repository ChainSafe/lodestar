import {ExtendedValidatorResult} from "../constants";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {ILogger} from "@chainsafe/lodestar-utils";
import {Attestation} from "@chainsafe/lodestar-types";
import {toHexString} from "@chainsafe/ssz";
import {IBeaconDb} from "../../../db/api";
import {IBeaconChain, ILMDGHOST} from "../../../chain";
import {ITreeStateContext} from "../../../db/api/beacon/stateContextCache";

export async function validateGossipAttestation(
  config: IBeaconConfig, chain: IBeaconChain, db: IBeaconDb, logger: ILogger, attestation: Attestation, subnet: number
): Promise<ExtendedValidatorResult> {
  const attestationRoot = config.types.Attestation.hashTreeRoot(attestation);
  const attestationLogContext = {
    attestationSlot: attestation.data.slot,
    attestationBlockRoot: toHexString(attestation.data.beaconBlockRoot),
    attestationRoot: toHexString(attestationRoot),
    subnet
  };
  logger.verbose(
    "Started gossip committee attestation validation",
    attestationLogContext
  );

  if(attestation.aggregationBits.length === 0) {
    logger.warn("Rejected committee attestation", {reason: "empty aggreagtion bits", ...attestationLogContext});
    return ExtendedValidatorResult.reject;
  }

  if(await isAttestingToInValidBlock(db, attestation)) {
    logger.warn("Rejected committee attestation", {reason: "attestation block is invalid", ...attestationLogContext});
  }



  logger.info("Received valid committee attestation", attestationLogContext);
  return ExtendedValidatorResult.accept;
}

export async function isAttestingToInValidBlock(db: IBeaconDb, attestation: Attestation): Promise<boolean> {
  const blockRoot = attestation.data.beaconBlockRoot.valueOf() as Uint8Array;
  //TODO: check if source and target blocks are not in bad block
  return await db.badBlock.has(blockRoot);
}

export async function getAttestationStateContext(forkChoice: ILMDGHOST, attestation: Attestation): Promise<ITreeStateContext> {
    const checkpointBlock = forkChoice.getBlockSummaryByBlockRoot(attestation.data.target.root.valueOf() as Uint8Array);
}
