import {DOMAIN_BEACON_ATTESTER} from "@lodestar/params";
import {allForks, phase0, ssz} from "@lodestar/types";
import {computeSigningRoot, computeStartSlotAtEpoch, ISignatureSet, SignatureSetType} from "../util/index.js";
import {CachedBeaconStateAllForks} from "../types.js";
import {Index2PubkeyCache} from "../cache/pubkeyCache.js";

export function getAttestationWithIndicesSignatureSet(
  state: CachedBeaconStateAllForks,
  attestation: Pick<phase0.Attestation, "data" | "signature">,
  indices: number[]
): ISignatureSet {
  const {epochCtx} = state;
  const slot = computeStartSlotAtEpoch(attestation.data.target.epoch);
  const domain = state.config.getDomain(state.slot, DOMAIN_BEACON_ATTESTER, slot);

  return {
    type: SignatureSetType.aggregate,
    pubkeys: indices.map((i) => epochCtx.index2pubkey[i]),
    signingRoot: computeSigningRoot(ssz.phase0.AttestationData, attestation.data, domain),
    signature: attestation.signature,
  };
}

export function getIndexedAttestationSignatureSet(
  state: CachedBeaconStateAllForks,
  indexedAttestation: phase0.IndexedAttestation
): ISignatureSet {
  return getAttestationWithIndicesSignatureSet(state, indexedAttestation, indexedAttestation.attestingIndices);
}

/**
 * Create signature set for indexed attestation with same attestation data as another indexed attestation.
 * Be careful with this function, it assume `signatureSetSameAttData` is from the same attestation data.
 */
export function cloneIndexedAttestationSignatureSet(
  index2pubkey: Index2PubkeyCache,
  indexedAttestation: phase0.IndexedAttestation,
  signatureSetSameAttData: ISignatureSet
): ISignatureSet {
  return {
    type: SignatureSetType.aggregate,
    pubkeys: indexedAttestation.attestingIndices.map((i) => index2pubkey[i]),
    signingRoot: signatureSetSameAttData.signingRoot,
    signature: indexedAttestation.signature,
  };
}

export function getAttestationsSignatureSets(
  state: CachedBeaconStateAllForks,
  signedBlock: allForks.SignedBeaconBlock
): ISignatureSet[] {
  return signedBlock.message.body.attestations.map((attestation) =>
    getIndexedAttestationSignatureSet(state, state.epochCtx.getIndexedAttestation(attestation))
  );
}
