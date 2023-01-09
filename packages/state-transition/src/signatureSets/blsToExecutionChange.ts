import {DOMAIN_BLS_TO_EXECUTION_CHANGE} from "@lodestar/params";
import {capella, Slot, ssz} from "@lodestar/types";
import {IBeaconConfig} from "@lodestar/config";
import bls from "@chainsafe/bls";
import {CoordType} from "@chainsafe/bls/types";

import {computeSigningRoot, ISignatureSet, SignatureSetType, verifySignatureSet} from "../util/index.js";
import {CachedBeaconStateAllForks} from "../types.js";

export function verifyBlsToExecutionChangeSignature(
  state: CachedBeaconStateAllForks,
  signedBLSToExecutionChange: capella.SignedBLSToExecutionChange
): boolean {
  return verifySignatureSet(getBlsToExecutionChangeSignatureSet(state.config, state.slot, signedBLSToExecutionChange));
}

/**
 * Extract signatures to allow validating all block signatures at once
 */
export function getBlsToExecutionChangeSignatureSet(
  config: IBeaconConfig,
  signatureSlot: Slot,
  signedBLSToExecutionChange: capella.SignedBLSToExecutionChange
): ISignatureSet {
  const domain = config.getDomain(signatureSlot, DOMAIN_BLS_TO_EXECUTION_CHANGE);

  return {
    type: SignatureSetType.single,
    // The withdrawal pubkey is the same as signedBLSToExecutionChange's fromBlsPubkey as it should
    // be validated against the withdrawal credentials digest
    pubkey: bls.PublicKey.fromBytes(signedBLSToExecutionChange.message.fromBlsPubkey, CoordType.affine, true),
    signingRoot: computeSigningRoot(ssz.capella.BLSToExecutionChange, signedBLSToExecutionChange.message, domain),
    signature: signedBLSToExecutionChange.signature,
  };
}

export function getBlsToExecutionChangeSignatureSets(
  config: IBeaconConfig,
  signatureSlot: Slot,
  signedBlock: capella.SignedBeaconBlock
): ISignatureSet[] {
  return signedBlock.message.body.blsToExecutionChanges.map((blsToExecutionChange) =>
    getBlsToExecutionChangeSignatureSet(config, signatureSlot, blsToExecutionChange)
  );
}
