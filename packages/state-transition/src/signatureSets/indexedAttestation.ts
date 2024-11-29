import {DOMAIN_BEACON_ATTESTER} from "@lodestar/params";
import {SignedBeaconBlock, phase0, ssz} from "@lodestar/types";
import {CachedBeaconStateAllForks} from "../types.js";
import {
  ISignatureSet,
  computeSigningRoot,
  computeStartSlotAtEpoch,
  createAggregateSignatureSetFromComponents,
} from "../util/index.js";

export function getAttestationDataSigningRoot(
  state: CachedBeaconStateAllForks,
  data: phase0.AttestationData
): Uint8Array {
  const slot = computeStartSlotAtEpoch(data.target.epoch);
  const domain = state.config.getDomain(state.slot, DOMAIN_BEACON_ATTESTER, slot);

  return computeSigningRoot(ssz.phase0.AttestationData, data, domain);
}

export function getAttestationWithIndicesSignatureSet(
  state: CachedBeaconStateAllForks,
  attestation: Pick<phase0.Attestation, "data" | "signature">,
  attestingIndices: number[]
): ISignatureSet {
  return createAggregateSignatureSetFromComponents(
    attestingIndices.map((i) => state.epochCtx.index2pubkey[i]),
    getAttestationDataSigningRoot(state, attestation.data),
    attestation.signature
  );
}

export function getIndexedAttestationSignatureSet(
  state: CachedBeaconStateAllForks,
  indexedAttestation: phase0.IndexedAttestation
): ISignatureSet {
  return getAttestationWithIndicesSignatureSet(state, indexedAttestation, indexedAttestation.attestingIndices);
}

export function getAttestationsSignatureSets(
  state: CachedBeaconStateAllForks,
  signedBlock: SignedBeaconBlock
): ISignatureSet[] {
  // TODO: figure how to get attesting indices of an attestation once per block processing
  return signedBlock.message.body.attestations.map((attestation) =>
    getIndexedAttestationSignatureSet(
      state,
      state.epochCtx.getIndexedAttestation(state.config.getForkSeq(signedBlock.message.slot), attestation)
    )
  );
}
