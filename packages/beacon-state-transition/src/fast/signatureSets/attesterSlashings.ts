import {readonlyValues} from "@chainsafe/ssz";
import {allForks} from "@chainsafe/lodestar-types";
import {ISignatureSet} from "../../util";
import {CachedBeaconState} from "../util";
import {getIndexedAttestationSignatureSet} from "./indexedAttestation";

export function getAttesterSlashingsSignatureSets(
  state: CachedBeaconState<allForks.BeaconState>,
  signedBlock: allForks.SignedBeaconBlock
): ISignatureSet[] {
  return Array.from(readonlyValues(signedBlock.message.body.attesterSlashings), (attesterSlashing) =>
    [attesterSlashing.attestation1, attesterSlashing.attestation2].map((attestation) =>
      getIndexedAttestationSignatureSet(state, attestation)
    )
  ).flat(1);
}
