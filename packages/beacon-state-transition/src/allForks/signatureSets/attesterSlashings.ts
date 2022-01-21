import {allForks, phase0} from "@chainsafe/lodestar-types";
import {ISignatureSet} from "../../util";
import {CachedBeaconStateAllForks} from "../../types";
import {getIndexedAttestationSignatureSet} from "./indexedAttestation";

/** Get signature sets from a single AttesterSlashing object */
export function getAttesterSlashingSignatureSets(
  state: CachedBeaconStateAllForks,
  attesterSlashing: phase0.AttesterSlashing
): ISignatureSet[] {
  return [attesterSlashing.attestation1, attesterSlashing.attestation2].map((attestation) =>
    getIndexedAttestationSignatureSet(state, attestation)
  );
}

/** Get signature sets from all AttesterSlashing objects in a block */
export function getAttesterSlashingsSignatureSets(
  state: CachedBeaconStateAllForks,
  signedBlock: allForks.SignedBeaconBlock
): ISignatureSet[] {
  const signatureSets: ISignatureSet[] = [];

  for (const attesterSlashing of signedBlock.message.body.attesterSlashings) {
    const attesterSlashingSigSets = getAttesterSlashingSignatureSets(state, attesterSlashing);

    for (const signatureSet of attesterSlashingSigSets) {
      signatureSets.push(signatureSet);
    }
  }

  return signatureSets;
}
