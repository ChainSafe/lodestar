import {BeaconConfig} from "@lodestar/config";
import {DOMAIN_BEACON_ATTESTER} from "@lodestar/params";
import {IndexedAttestation, SignedBeaconBlock, Slot, phase0, ssz} from "@lodestar/types";
import {Index2PubkeyCache} from "../cache/pubkeyCache.js";
import {
  ISignatureSet,
  computeSigningRoot,
  computeStartSlotAtEpoch,
  createAggregateSignatureSetFromComponents,
} from "../util/index.js";

export function getAttestationDataSigningRoot(
  config: BeaconConfig,
  stateSlot: Slot,
  data: phase0.AttestationData
): Uint8Array {
  const messageSlot = computeStartSlotAtEpoch(data.target.epoch);
  const domain = config.getDomain(stateSlot, DOMAIN_BEACON_ATTESTER, messageSlot);

  return computeSigningRoot(ssz.phase0.AttestationData, data, domain);
}

export function getAttestationWithIndicesSignatureSet(
  config: BeaconConfig,
  index2pubkey: Index2PubkeyCache,
  stateSlot: Slot,
  attestation: Pick<phase0.Attestation, "data" | "signature">,
  attestingIndices: number[]
): ISignatureSet {
  return createAggregateSignatureSetFromComponents(
    attestingIndices.map((i) => index2pubkey[i]),
    getAttestationDataSigningRoot(config, stateSlot, attestation.data),
    attestation.signature
  );
}

export function getIndexedAttestationSignatureSet(
  config: BeaconConfig,
  index2pubkey: Index2PubkeyCache,
  stateSlot: Slot,
  indexedAttestation: IndexedAttestation
): ISignatureSet {
  return getAttestationWithIndicesSignatureSet(
    config,
    index2pubkey,
    stateSlot,
    indexedAttestation,
    indexedAttestation.attestingIndices
  );
}

export function getAttestationsSignatureSets(
  config: BeaconConfig,
  index2pubkey: Index2PubkeyCache,
  signedBlock: SignedBeaconBlock,
  indexedAttestations: IndexedAttestation[]
): ISignatureSet[] {
  if (indexedAttestations.length !== signedBlock.message.body.attestations.length) {
    throw Error(
      `Indexed attestations length mismatch: got ${indexedAttestations.length}, expected ${signedBlock.message.body.attestations.length}`
    );
  }
  // the getDomain() api requires the state slot as 1st param, however it's the same to block.slot in state-transition
  // and the same epoch when we verify blocks in batch in beacon-node. So we can safely use block.slot here.
  const blockSlot = signedBlock.message.slot;
  return indexedAttestations.map((indexedAttestation) =>
    getIndexedAttestationSignatureSet(config, index2pubkey, blockSlot, indexedAttestation)
  );
}
