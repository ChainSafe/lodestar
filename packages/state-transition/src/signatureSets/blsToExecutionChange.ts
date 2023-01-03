import {DOMAIN_BLS_TO_EXECUTION_CHANGE} from "@lodestar/params";
import {capella, ssz} from "@lodestar/types";
import bls from "@chainsafe/bls";
import {CoordType} from "@chainsafe/bls/types";

import {computeSigningRoot, ISignatureSet, SignatureSetType, verifySignatureSet} from "../util/index.js";
import {CachedBeaconStateAllForks} from "../types.js";

export function verifyBlsToExecutionChangeSignature(
  state: CachedBeaconStateAllForks,
  signedBLSToExecutionChange: capella.SignedBLSToExecutionChange
): boolean {
  return verifySignatureSet(getBlsToExecutionChangeSignatureSet(state, signedBLSToExecutionChange));
}

/**
 * Extract signatures to allow validating all block signatures at once
 */
export function getBlsToExecutionChangeSignatureSet(
  state: CachedBeaconStateAllForks,
  signedBLSToExecutionChange: capella.SignedBLSToExecutionChange
): ISignatureSet {
  const domain = state.config.getDomain(state.slot, DOMAIN_BLS_TO_EXECUTION_CHANGE);

  return {
    type: SignatureSetType.single,
    // The withdrawal publey is the same as signedBLSToExecutionChange's fromBlsPubkey as it should
    // be validated against the withdrawal credentials digest
    pubkey: bls.PublicKey.fromBytes(signedBLSToExecutionChange.message.fromBlsPubkey, CoordType.affine, true),
    signingRoot: computeSigningRoot(ssz.capella.BLSToExecutionChange, signedBLSToExecutionChange.message, domain),
    signature: signedBLSToExecutionChange.signature,
  };
}

export function getBlsToExecutionChangeSignatureSets(
  state: CachedBeaconStateAllForks,
  signedBlock: capella.SignedBeaconBlock
): ISignatureSet[] {
  return signedBlock.message.body.blsToExecutionChanges.map((blsToExecutionChange) =>
    getBlsToExecutionChangeSignatureSet(state, blsToExecutionChange)
  );
}
