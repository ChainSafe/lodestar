import {readOnlyMap} from "@chainsafe/ssz";
import {phase0} from "@chainsafe/lodestar-types";
import {ISignatureSet} from "../../../util";
import {getIndexedAttestationSignatureSet} from "../block/isValidIndexedAttestation";
import {CachedBeaconState} from "../util";

export function getAttesterSlashingsSignatureSets(
  state: CachedBeaconState<phase0.BeaconState>,
  signedBlock: phase0.SignedBeaconBlock
): ISignatureSet[] {
  return readOnlyMap(signedBlock.message.body.attesterSlashings, (attesterSlashing) =>
    [attesterSlashing.attestation1, attesterSlashing.attestation2].map((attestation) =>
      getIndexedAttestationSignatureSet(state, attestation)
    )
  ).flat(1);
}
