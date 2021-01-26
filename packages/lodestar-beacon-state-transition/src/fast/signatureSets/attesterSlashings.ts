import {readOnlyMap} from "@chainsafe/ssz";
import {SignedBeaconBlock} from "@chainsafe/lodestar-types";
import {ISignatureSet} from "./types";
import {getIndexedAttestationSignatureSet} from "../block/isValidIndexedAttestation";
import {CachedBeaconState} from "../util/cachedBeaconState";

export function getAttesterSlashingsSignatureSets(
  cachedState: CachedBeaconState,
  signedBlock: SignedBeaconBlock
): ISignatureSet[] {
  return readOnlyMap(signedBlock.message.body.attesterSlashings, (attesterSlashing) =>
    [attesterSlashing.attestation1, attesterSlashing.attestation2].map((attestation) =>
      getIndexedAttestationSignatureSet(cachedState, attestation)
    )
  ).flat(1);
}
