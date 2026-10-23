import {BeaconConfig} from "@lodestar/config";
import {DOMAIN_BEACON_ATTESTER, DOMAIN_FINALITY_ATTESTER, ForkPreEip8453} from "@lodestar/params";
import {AttesterSlashing, IndexedAttestationBigint, SignedBeaconBlock, Slot, eip8453, ssz} from "@lodestar/types";
import {ISignatureSet, SignatureSetType, computeSigningRoot, computeStartSlotAtEpoch} from "../util/index.js";

/** Get signature sets from all AttesterSlashing objects in a block */
export function getAttesterSlashingsSignatureSets(
  config: BeaconConfig,
  signedBlock: SignedBeaconBlock<ForkPreEip8453>
): ISignatureSet[] {
  // the getDomain() api requires the state slot as 1st param, however it's the same to block.slot in state-transition
  // and the same epoch when we verify blocks in batch in beacon-node. So we can safely use block.slot here.
  const blockSlot = signedBlock.message.slot;
  return signedBlock.message.body.attesterSlashings.flatMap((attesterSlashing) =>
    getAttesterSlashingSignatureSets(config, blockSlot, attesterSlashing)
  );
}

/** Get signature sets from a single AttesterSlashing object */
export function getAttesterSlashingSignatureSets(
  config: BeaconConfig,
  stateSlot: Slot,
  attesterSlashing: AttesterSlashing<ForkPreEip8453>
): ISignatureSet[] {
  return [attesterSlashing.attestation1, attesterSlashing.attestation2].map((attestation) =>
    getIndexedAttestationBigintSignatureSet(config, stateSlot, attestation)
  );
}

export function getIndexedAttestationBigintSignatureSet(
  config: BeaconConfig,
  stateSlot: Slot,
  indexedAttestation: IndexedAttestationBigint<ForkPreEip8453>
): ISignatureSet {
  const messageSlot = computeStartSlotAtEpoch(Number(indexedAttestation.data.target.epoch as bigint));
  const domain = config.getDomain(stateSlot, DOMAIN_BEACON_ATTESTER, messageSlot);

  return {
    type: SignatureSetType.aggregate,
    indices: indexedAttestation.attestingIndices.map((i) => Number(i)),
    signingRoot: computeSigningRoot(ssz.phase0.AttestationDataBigint, indexedAttestation.data, domain),
    signature: indexedAttestation.signature,
  };
}

/** Signature sets of an EIP8453 attester slashing, whose attestations are signed under DOMAIN_FINALITY_ATTESTER */
export function getAttesterSlashingSignatureSetsEip8453(
  config: BeaconConfig,
  stateSlot: Slot,
  attesterSlashing: eip8453.AttesterSlashing
): ISignatureSet[] {
  return [attesterSlashing.attestation1, attesterSlashing.attestation2].map((attestation) =>
    getIndexedAttestationBigintSignatureSetEip8453(config, stateSlot, attestation)
  );
}

export function getIndexedAttestationBigintSignatureSetEip8453(
  config: BeaconConfig,
  stateSlot: Slot,
  indexedAttestation: eip8453.IndexedAttestationBigint
): ISignatureSet {
  const messageSlot = computeStartSlotAtEpoch(Number(indexedAttestation.epoch));
  const domain = config.getDomain(stateSlot, DOMAIN_FINALITY_ATTESTER, messageSlot);

  return {
    type: SignatureSetType.aggregate,
    indices: indexedAttestation.attestingIndices.map((i) => Number(i)),
    signingRoot: computeSigningRoot(ssz.eip8453.AttestationDataBigint, indexedAttestation.data, domain),
    signature: indexedAttestation.signature,
  };
}
