import {allForks, phase0, ssz} from "@chainsafe/lodestar-types";
import {computeSigningRoot, computeStartSlotAtEpoch, ISignatureSet, SignatureSetType} from "../../util/index.js";
import {CachedBeaconStateAllForks} from "../../types.js";
import {DOMAIN_BEACON_ATTESTER} from "@chainsafe/lodestar-params";

/** Get signature sets from all AttesterSlashing objects in a block */
export function getAttesterSlashingsSignatureSets(
  state: CachedBeaconStateAllForks,
  signedBlock: allForks.SignedBeaconBlock
): ISignatureSet[] {
  return signedBlock.message.body.attesterSlashings
    .map((attesterSlashing) => getAttesterSlashingSignatureSets(state, attesterSlashing))
    .flat(1);
}

/** Get signature sets from a single AttesterSlashing object */
export function getAttesterSlashingSignatureSets(
  state: CachedBeaconStateAllForks,
  attesterSlashing: phase0.AttesterSlashing
): ISignatureSet[] {
  return [attesterSlashing.attestation1, attesterSlashing.attestation2].map((attestation) =>
    getIndexedAttestationBigintSignatureSet(state, attestation)
  );
}

export function getIndexedAttestationBigintSignatureSet(
  state: CachedBeaconStateAllForks,
  indexedAttestation: phase0.IndexedAttestationBigint
): ISignatureSet {
  const {index2pubkey} = state.epochCtx;
  const slot = computeStartSlotAtEpoch(Number(indexedAttestation.data.target.epoch as bigint));
  const domain = state.config.getDomain(DOMAIN_BEACON_ATTESTER, slot);

  return {
    type: SignatureSetType.aggregate,
    pubkeys: indexedAttestation.attestingIndices.map((i) => index2pubkey[i]),
    signingRoot: computeSigningRoot(ssz.phase0.AttestationDataBigint, indexedAttestation.data, domain),
    signature: indexedAttestation.signature,
  };
}
