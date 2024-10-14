import {SignedBeaconBlock, ssz, AttesterSlashing, IndexedAttestationBigint} from "@lodestar/types";
import {DOMAIN_BEACON_ATTESTER} from "@lodestar/params";
import {computeSigningRoot, computeStartSlotAtEpoch, ISignatureSet, SignatureSetType} from "../util/index.js";
import {CachedBeaconStateAllForks} from "../types.js";

/** Get signature sets from all AttesterSlashing objects in a block */
export function getAttesterSlashingsSignatureSets(
  state: CachedBeaconStateAllForks,
  signedBlock: SignedBeaconBlock
): ISignatureSet[] {
  return signedBlock.message.body.attesterSlashings.flatMap((attesterSlashing) =>
    getAttesterSlashingSignatureSets(state, attesterSlashing)
  );
}

/** Get signature sets from a single AttesterSlashing object */
export function getAttesterSlashingSignatureSets(
  state: CachedBeaconStateAllForks,
  attesterSlashing: AttesterSlashing
): ISignatureSet[] {
  return [attesterSlashing.attestation1, attesterSlashing.attestation2].map((attestation) =>
    getIndexedAttestationBigintSignatureSet(state, attestation)
  );
}

export function getIndexedAttestationBigintSignatureSet(
  state: CachedBeaconStateAllForks,
  indexedAttestation: IndexedAttestationBigint
): ISignatureSet {
  const slot = computeStartSlotAtEpoch(Number(indexedAttestation.data.target.epoch as bigint));
  const domain = state.config.getDomain(state.slot, DOMAIN_BEACON_ATTESTER, slot);

  return {
    type: SignatureSetType.aggregate,
    pubkeys: indexedAttestation.attestingIndices.map((i) => state.epochCtx.index2pubkey[i]),
    signingRoot: computeSigningRoot(ssz.phase0.AttestationDataBigint, indexedAttestation.data, domain),
    signature: indexedAttestation.signature,
  };
}
