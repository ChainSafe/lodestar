import {allForks, phase0, ssz} from "@lodestar/types";
import {DOMAIN_BEACON_ATTESTER} from "@lodestar/params";
import {computeSigningRoot, computeStartSlotAtEpoch, ISignatureSet, SignatureSetType} from "../util/index.js";
import {CachedBeaconStateAllForks} from "../types.js";
import {bytesToInt} from "@lodestar/utils";

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
    getIndexedAttestationBytes8SignatureSet(state, attestation)
  );
}

export function getIndexedAttestationBytes8SignatureSet(
  state: CachedBeaconStateAllForks,
  indexedAttestation: phase0.IndexedAttestationBytes8
): ISignatureSet {
  const {index2pubkey} = state.epochCtx;
  const targetEpoch = indexedAttestation.data.target.epoch;
  const slot = computeStartSlotAtEpoch(bytesToInt(targetEpoch));
  const domain = state.config.getDomain(state.slot, DOMAIN_BEACON_ATTESTER, slot);

  return {
    type: SignatureSetType.aggregate,
    pubkeys: indexedAttestation.attestingIndices.map((i) => index2pubkey[i]),
    signingRoot: computeSigningRoot(ssz.phase0.AttestationDataBytes8, indexedAttestation.data, domain),
    signature: indexedAttestation.signature,
  };
}
