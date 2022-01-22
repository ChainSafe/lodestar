import {readonlyValues} from "@chainsafe/ssz";
import {allForks, phase0} from "@chainsafe/lodestar-types";
import {ISignatureSet} from "../../util";
import {BeaconStateCachedAllForks} from "../util";
import {getIndexedAttestationSignatureSet} from "./indexedAttestation";

/** Get signature sets from a single AttesterSlashing object */
export function getAttesterSlashingSignatureSets(
  state: BeaconStateCachedAllForks,
  attesterSlashing: phase0.AttesterSlashing
): ISignatureSet[] {
  return [attesterSlashing.attestation1, attesterSlashing.attestation2].map((attestation) =>
    getIndexedAttestationSignatureSet(state, attestation)
  );
}

/** Get signature sets from all AttesterSlashing objects in a block */
export function getAttesterSlashingsSignatureSets(
  state: BeaconStateCachedAllForks,
  signedBlock: allForks.SignedBeaconBlock
): ISignatureSet[] {
  return Array.from(readonlyValues(signedBlock.message.body.attesterSlashings), (attesterSlashing) =>
    getAttesterSlashingSignatureSets(state, attesterSlashing)
  ).flat(1);
}
