import {BeaconConfig} from "@lodestar/config";
import {DOMAIN_BEACON_ATTESTER, DOMAIN_FINALITY_ATTESTER, DOMAIN_HEAD_VOTE, ForkPreEip8453} from "@lodestar/params";
import {IndexedAttestation, SignedBeaconBlock, Slot, eip8453, phase0, ssz} from "@lodestar/types";
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
  indexedAttestation: IndexedAttestation<ForkPreEip8453>
): ISignatureSet {
  return getAttestationWithIndicesSignatureSet(
    config,
    stateSlot,
    indexedAttestation,
    indexedAttestation.attestingIndices
  );
}

export function getAttestationsSignatureSets(
  config: BeaconConfig,
  signedBlock: SignedBeaconBlock<ForkPreEip8453>,
  indexedAttestations: IndexedAttestation<ForkPreEip8453>[]
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
    getIndexedAttestationSignatureSet(config, blockSlot, indexedAttestation)
  );
}

/** `get_domain(state, DOMAIN_FINALITY_ATTESTER, epoch)` signing root of an EIP8453 attestation data */
export function getFinalityAttestationDataSigningRoot(
  config: BeaconConfig,
  stateSlot: Slot,
  data: eip8453.AttestationData,
  epoch: number
): Uint8Array {
  const domain = config.getDomain(stateSlot, DOMAIN_FINALITY_ATTESTER, computeStartSlotAtEpoch(epoch));
  return computeSigningRoot(ssz.eip8453.AttestationData, data, domain);
}

export function getIndexedAttestationSignatureSetEip8453(
  config: BeaconConfig,
  stateSlot: Slot,
  indexedAttestation: eip8453.IndexedAttestation
): ISignatureSet {
  return createAggregateSignatureSetFromComponents(
    indexedAttestation.attestingIndices,
    getFinalityAttestationDataSigningRoot(config, stateSlot, indexedAttestation.data, indexedAttestation.epoch),
    indexedAttestation.signature
  );
}

/** `get_domain(state, DOMAIN_HEAD_VOTE, compute_epoch_at_slot(data.slot))` signing root of a head vote */
export function getHeadVoteDataSigningRoot(
  config: BeaconConfig,
  stateSlot: Slot,
  data: eip8453.HeadVoteData
): Uint8Array {
  const domain = config.getDomain(stateSlot, DOMAIN_HEAD_VOTE, data.slot);
  return computeSigningRoot(ssz.eip8453.HeadVoteData, data, domain);
}

/** Signature set of an aggregated head vote, given the head vote committee of its slot */
export function getHeadVoteSignatureSet(
  config: BeaconConfig,
  stateSlot: Slot,
  headVote: eip8453.HeadVote,
  committee: Uint32Array
): ISignatureSet {
  const indices: number[] = [];
  for (const position of headVote.aggregationBits.getTrueBitIndexes()) {
    indices.push(committee[position]);
  }
  return createAggregateSignatureSetFromComponents(
    indices,
    getHeadVoteDataSigningRoot(config, stateSlot, headVote.data),
    headVote.signature
  );
}
