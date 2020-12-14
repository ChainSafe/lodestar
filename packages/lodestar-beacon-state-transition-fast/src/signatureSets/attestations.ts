import {readOnlyMap} from "@chainsafe/ssz";
import {BeaconState, SignedBeaconBlock} from "@chainsafe/lodestar-types";
import {ISignatureSet} from "./types";
import {EpochContext} from "../index";
import {getIndexedAttestationSignatureSet} from "../block/isValidIndexedAttestation";

export function getAttestationsSignatureSets(
  epochCtx: EpochContext,
  state: BeaconState,
  signedBlock: SignedBeaconBlock
): ISignatureSet[] {
  return readOnlyMap(signedBlock.message.body.attestations, (attestation) =>
    getIndexedAttestationSignatureSet(epochCtx, state, epochCtx.getIndexedAttestation(attestation))
  );
}
