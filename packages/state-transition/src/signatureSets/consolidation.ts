import {DOMAIN_CONSOLIDATION, ForkName} from "@lodestar/params";
import {electra, ssz} from "@lodestar/types";

import {computeSigningRoot, createAggregateSignatureSetFromComponents, ISignatureSet, SignatureSetType, verifySignatureSet} from "../util/index.js";
import {CachedBeaconStateElectra} from "../types.js";

export function verifyConsolidationSignature(
  state: CachedBeaconStateElectra,
  signedConsolidation: electra.SignedConsolidation
): boolean {
  return verifySignatureSet(getConsolidationSignatureSet(state, signedConsolidation));
}

/**
 * Extract signatures to allow validating all block signatures at once
 */
export function getConsolidationSignatureSet(
  state: CachedBeaconStateElectra,
  signedConsolidation: electra.SignedConsolidation,
): ISignatureSet {
  const {config} = state;
  const {index2pubkey} = state.epochCtx; // TODO Electra: Use 6110 pubkey cache
  const {sourceIndex, targetIndex} = signedConsolidation.message;
  const sourcePubkey = index2pubkey[sourceIndex];
  const targetPubkey = index2pubkey[targetIndex];

  // signatureFork for signing domain is fixed
  const signatureFork = ForkName.phase0;
  const domain = config.getDomainAtFork(signatureFork, DOMAIN_CONSOLIDATION);
  const signingRoot = computeSigningRoot(ssz.electra.Consolidation, signedConsolidation.message, domain);
  
  return createAggregateSignatureSetFromComponents([sourcePubkey, targetPubkey], signingRoot, signedConsolidation.signature);
}

export function getConsolidationSignatureSets(state: CachedBeaconStateElectra, signedBlock: electra.SignedBeaconBlock): ISignatureSet[] {
  return signedBlock.message.body.consolidations.map((consolidation) => 
    getConsolidationSignatureSet(state, consolidation)
  );
}