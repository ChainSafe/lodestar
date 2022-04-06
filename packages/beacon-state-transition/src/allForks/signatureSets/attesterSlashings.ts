import {allForks, phase0} from "@chainsafe/lodestar-types";
import {ISignatureSet} from "../../util/index.js";
import {CachedBeaconStateAllForks} from "../../types.js";
import {getIndexedAttestationSignatureSet} from "./indexedAttestation.js";

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
  return signedBlock.message.body.attesterSlashings
    .map((attesterSlashing) => getAttesterSlashingSignatureSets(state, attesterSlashing))
    .flat(1);
}
