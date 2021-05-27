import {DOMAIN_BEACON_ATTESTER} from "@chainsafe/lodestar-params";
import {allForks, phase0, ssz} from "@chainsafe/lodestar-types";
import {readonlyValues} from "@chainsafe/ssz";
import {computeSigningRoot, getDomain, ISignatureSet, SignatureSetType, verifySignatureSet} from "../../util";
import {CachedBeaconState} from "../util";

export function verifyIndexedAttestationSignature(
  state: CachedBeaconState<allForks.BeaconState>,
  indexedAttestation: phase0.IndexedAttestation,
  indices?: number[]
): boolean {
  return verifySignatureSet(getIndexedAttestationSignatureSet(state, indexedAttestation, indices));
}

export function getIndexedAttestationSignatureSet(
  state: CachedBeaconState<allForks.BeaconState>,
  indexedAttestation: phase0.IndexedAttestation,
  indices?: number[]
): ISignatureSet {
  const {epochCtx} = state;
  const domain = getDomain(state, DOMAIN_BEACON_ATTESTER, indexedAttestation.data.target.epoch);

  if (!indices) indices = Array.from(readonlyValues(indexedAttestation.attestingIndices));
  return {
    type: SignatureSetType.aggregate,
    pubkeys: indices.map((i) => epochCtx.index2pubkey[i]),
    signingRoot: computeSigningRoot(ssz.phase0.AttestationData, indexedAttestation.data, domain),
    signature: indexedAttestation.signature.valueOf() as Uint8Array,
  };
}

export function getAttestationsSignatureSets(
  state: CachedBeaconState<allForks.BeaconState>,
  signedBlock: allForks.SignedBeaconBlock
): ISignatureSet[] {
  return Array.from(readonlyValues(signedBlock.message.body.attestations), (attestation) =>
    getIndexedAttestationSignatureSet(state, state.getIndexedAttestation(attestation))
  );
}
