import {BeaconConfig} from "@lodestar/config";
import {DOMAIN_BEACON_ATTESTER} from "@lodestar/params";
import {AttesterSlashing, IndexedAttestationBigint, SignedBeaconBlock, Slot, ssz} from "@lodestar/types";
import {ISignatureSet, SignatureSetType, computeSigningRoot, computeStartSlotAtEpoch} from "../util/index.js";

/** Get signature sets from all AttesterSlashing objects in a block */
export function getAttesterSlashingsSignatureSets(
  config: BeaconConfig,
  signedBlock: SignedBeaconBlock
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
  attesterSlashing: AttesterSlashing
): ISignatureSet[] {
  return [attesterSlashing.attestation1, attesterSlashing.attestation2].map((attestation) =>
    getIndexedAttestationBigintSignatureSet(config, stateSlot, attestation)
  );
}

export function getIndexedAttestationBigintSignatureSet(
  config: BeaconConfig,
  stateSlot: Slot,
  indexedAttestation: IndexedAttestationBigint
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
