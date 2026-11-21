import {BeaconConfig} from "@lodestar/config";
import {PublicKey, aggregatePublicKeys} from "@lodestar/native/blst";
import {pubkeyCache} from "@lodestar/native/pubkeys";
import {DOMAIN_BEACON_ATTESTER} from "@lodestar/params";
import {
  AttesterSlashing,
  IndexedAttestationBigint,
  SignedBeaconBlock,
  Slot,
  ValidatorIndex,
  ssz,
} from "@lodestar/types";
import {ISignatureSet, SignatureSetType, computeSigningRoot, computeStartSlotAtEpoch} from "../util/index.js";

/** Returns the compressed pubkey of a validator in the state the operation is verified against */
export type StatePubkeyGetter = (index: ValidatorIndex) => Uint8Array;

/** Get signature sets from all AttesterSlashing objects in a block */
export function getAttesterSlashingsSignatureSets(
  config: BeaconConfig,
  signedBlock: SignedBeaconBlock,
  getStatePubkey: StatePubkeyGetter
): ISignatureSet[] {
  // the getDomain() api requires the state slot as 1st param, however it's the same to block.slot in state-transition
  // and the same epoch when we verify blocks in batch in beacon-node. So we can safely use block.slot here.
  const blockSlot = signedBlock.message.slot;
  return signedBlock.message.body.attesterSlashings.flatMap((attesterSlashing) =>
    getAttesterSlashingSignatureSets(config, blockSlot, attesterSlashing, getStatePubkey)
  );
}

/** Get signature sets from a single AttesterSlashing object */
export function getAttesterSlashingSignatureSets(
  config: BeaconConfig,
  stateSlot: Slot,
  attesterSlashing: AttesterSlashing,
  getStatePubkey: StatePubkeyGetter
): ISignatureSet[] {
  return [attesterSlashing.attestation1, attesterSlashing.attestation2].map((attestation) =>
    getIndexedAttestationBigintSignatureSet(config, stateSlot, attestation, getStatePubkey)
  );
}

/**
 * Unlike committee attestations, attester slashings can name validators that are not active yet. Their keys can be
 * past the finalized prefix held by the shared pubkey cache, so those are read from the state.
 */
export function getIndexedAttestationBigintSignatureSet(
  config: BeaconConfig,
  stateSlot: Slot,
  indexedAttestation: IndexedAttestationBigint,
  getStatePubkey: StatePubkeyGetter
): ISignatureSet {
  const messageSlot = computeStartSlotAtEpoch(Number(indexedAttestation.data.target.epoch as bigint));
  const domain = config.getDomain(stateSlot, DOMAIN_BEACON_ATTESTER, messageSlot);
  const signingRoot = computeSigningRoot(ssz.phase0.AttestationDataBigint, indexedAttestation.data, domain);
  const indices = indexedAttestation.attestingIndices.map((i) => Number(i));

  const cachedCount = pubkeyCache.size;
  if (indices.some((index) => index >= cachedCount)) {
    const pubkeys = indices.map((index) => pubkeyCache.get(index) ?? PublicKey.fromBytes(getStatePubkey(index)));
    return {
      type: SignatureSetType.single,
      pubkey: aggregatePublicKeys(pubkeys).toBytes(),
      signingRoot,
      signature: indexedAttestation.signature,
    };
  }

  return {
    type: SignatureSetType.aggregate,
    indices,
    signingRoot,
    signature: indexedAttestation.signature,
  };
}
