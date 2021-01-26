import {readOnlyMap} from "@chainsafe/ssz";
import {SignedBeaconBlock} from "@chainsafe/lodestar-types";
import {ISignatureSet} from "./types";
import {getIndexedAttestationSignatureSet} from "../block/isValidIndexedAttestation";
import {CachedBeaconState} from "../util/cachedBeaconState";

export function getAttestationsSignatureSets(
  cachedState: CachedBeaconState,
  signedBlock: SignedBeaconBlock
): ISignatureSet[] {
  return readOnlyMap(signedBlock.message.body.attestations, (attestation) =>
    getIndexedAttestationSignatureSet(cachedState, cachedState.getIndexedAttestation(attestation))
  );
}
