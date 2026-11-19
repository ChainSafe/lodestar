import {BeaconConfig} from "@lodestar/config";
import {DOMAIN_BEACON_ATTESTER, ForkSeq} from "@lodestar/params";
import {IndexedAttestation, SignedBeaconBlock, Slot, electra, phase0, ssz} from "@lodestar/types";
import {
  EpochShuffling,
  ISignatureSet,
  SignatureSetType,
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
  stateSlot: Slot,
  attestation: Pick<phase0.Attestation, "data" | "signature">,
  attestingIndices: number[]
): ISignatureSet {
  return createAggregateSignatureSetFromComponents(
    attestingIndices,
    getAttestationDataSigningRoot(config, stateSlot, attestation.data),
    attestation.signature
  );
}

export function getIndexedAttestationSignatureSet(
  config: BeaconConfig,
  stateSlot: Slot,
  indexedAttestation: IndexedAttestation
): ISignatureSet {
  return getAttestationWithIndicesSignatureSet(
    config,
    stateSlot,
    indexedAttestation,
    indexedAttestation.attestingIndices
  );
}

/**
 * `shufflings[i]` is the shuffling of attestation `i`. Attestations whose shuffling has committee pubkeys get a
 * committee signature set.
 */
export function getAttestationsSignatureSets(
  config: BeaconConfig,
  signedBlock: SignedBeaconBlock,
  indexedAttestations: IndexedAttestation[],
  shufflings?: EpochShuffling[]
): ISignatureSet[] {
  if (indexedAttestations.length !== signedBlock.message.body.attestations.length) {
    throw Error(
      `Indexed attestations length mismatch: got ${indexedAttestations.length}, expected ${signedBlock.message.body.attestations.length}`
    );
  }
  // the getDomain() api requires the state slot as 1st param, however it's the same to block.slot in state-transition
  // and the same epoch when we verify blocks in batch in beacon-node. So we can safely use block.slot here.
  const blockSlot = signedBlock.message.slot;
  const fork = config.getForkSeq(blockSlot);
  return indexedAttestations.map((indexedAttestation, i) => {
    const committeePubkeysId = shufflings?.[i]?.committeePubkeysId;
    if (committeePubkeysId === undefined) {
      return getIndexedAttestationSignatureSet(config, blockSlot, indexedAttestation);
    }

    const attestation = signedBlock.message.body.attestations[i];
    return {
      type: SignatureSetType.committee,
      indices: indexedAttestation.attestingIndices,
      committeePubkeysId,
      slot: attestation.data.slot,
      committeeIndices:
        fork >= ForkSeq.electra
          ? (attestation as electra.Attestation).committeeBits.getTrueBitIndexes()
          : [attestation.data.index],
      aggregationBits: attestation.aggregationBits,
      signingRoot: getAttestationDataSigningRoot(config, blockSlot, attestation.data),
      signature: attestation.signature,
    };
  });
}
