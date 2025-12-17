import {BeaconConfig} from "@lodestar/config";
import {DOMAIN_BEACON_ATTESTER} from "@lodestar/params";
import {IndexedAttestation, SignedBeaconBlock, phase0, ssz} from "@lodestar/types";
import {Index2PubkeyCache} from "../cache/pubkeyCache.js";
import {CachedBeaconStateAllForks} from "../types.js";
import {
  ISignatureSet,
  computeSigningRoot,
  computeStartSlotAtEpoch,
  createAggregateSignatureSetFromComponents,
} from "../util/index.js";

export function getAttestationDataSigningRoot(
  config: BeaconConfig,
  state: CachedBeaconStateAllForks,
  data: phase0.AttestationData
): Uint8Array {
  const slot = computeStartSlotAtEpoch(data.target.epoch);
  const domain = config.getDomain(state.slot, DOMAIN_BEACON_ATTESTER, slot);

  return computeSigningRoot(ssz.phase0.AttestationData, data, domain);
}

export function getAttestationWithIndicesSignatureSet(
  config: BeaconConfig,
  index2pubkey: Index2PubkeyCache,
  state: CachedBeaconStateAllForks,
  attestation: Pick<phase0.Attestation, "data" | "signature">,
  attestingIndices: number[]
): ISignatureSet {
  return createAggregateSignatureSetFromComponents(
    attestingIndices.map((i) => index2pubkey[i]),
    getAttestationDataSigningRoot(config, state, attestation.data),
    attestation.signature
  );
}

export function getIndexedAttestationSignatureSet(
  config: BeaconConfig,
  index2pubkey: Index2PubkeyCache,
  state: CachedBeaconStateAllForks,
  indexedAttestation: IndexedAttestation
): ISignatureSet {
  return getAttestationWithIndicesSignatureSet(
    config,
    index2pubkey,
    state,
    indexedAttestation,
    indexedAttestation.attestingIndices
  );
}

export function getAttestationsSignatureSets(
  config: BeaconConfig,
  index2pubkey: Index2PubkeyCache,
  state: CachedBeaconStateAllForks,
  signedBlock: SignedBeaconBlock,
  indexedAttestations: IndexedAttestation[]
): ISignatureSet[] {
  if (indexedAttestations.length !== signedBlock.message.body.attestations.length) {
    throw Error(
      `Indexed attestations length mismatch: got ${indexedAttestations.length}, expected ${signedBlock.message.body.attestations.length}`
    );
  }
  return indexedAttestations.map((indexedAttestation) =>
    getIndexedAttestationSignatureSet(config, index2pubkey, state, indexedAttestation)
  );
}
