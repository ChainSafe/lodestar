import {BeaconConfig} from "@lodestar/config";
import {DOMAIN_BEACON_ATTESTER} from "@lodestar/params";
import {AttesterSlashing, IndexedAttestationBigint, SignedBeaconBlock, ssz} from "@lodestar/types";
import {Index2PubkeyCache} from "../cache/pubkeyCache.js";
import {CachedBeaconStateAllForks} from "../types.js";
import {ISignatureSet, SignatureSetType, computeSigningRoot, computeStartSlotAtEpoch} from "../util/index.js";

/** Get signature sets from all AttesterSlashing objects in a block */
export function getAttesterSlashingsSignatureSets(
  config: BeaconConfig,
  index2pubkey: Index2PubkeyCache,
  state: CachedBeaconStateAllForks,
  signedBlock: SignedBeaconBlock
): ISignatureSet[] {
  return signedBlock.message.body.attesterSlashings.flatMap((attesterSlashing) =>
    getAttesterSlashingSignatureSets(config, index2pubkey, state, attesterSlashing)
  );
}

/** Get signature sets from a single AttesterSlashing object */
export function getAttesterSlashingSignatureSets(
  config: BeaconConfig,
  index2pubkey: Index2PubkeyCache,
  state: CachedBeaconStateAllForks,
  attesterSlashing: AttesterSlashing
): ISignatureSet[] {
  return [attesterSlashing.attestation1, attesterSlashing.attestation2].map((attestation) =>
    getIndexedAttestationBigintSignatureSet(config, index2pubkey, state, attestation)
  );
}

export function getIndexedAttestationBigintSignatureSet(
  config: BeaconConfig,
  index2pubkey: Index2PubkeyCache,
  state: CachedBeaconStateAllForks,
  indexedAttestation: IndexedAttestationBigint
): ISignatureSet {
  const slot = computeStartSlotAtEpoch(Number(indexedAttestation.data.target.epoch as bigint));
  const domain = config.getDomain(state.slot, DOMAIN_BEACON_ATTESTER, slot);

  return {
    type: SignatureSetType.aggregate,
    pubkeys: indexedAttestation.attestingIndices.map((i) => index2pubkey[i]),
    signingRoot: computeSigningRoot(ssz.phase0.AttestationDataBigint, indexedAttestation.data, domain),
    signature: indexedAttestation.signature,
  };
}
