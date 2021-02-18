import {readOnlyMap} from "@chainsafe/ssz";
import {phase0} from "@chainsafe/lodestar-types";
import {ISignatureSet} from "./types";
import {EpochContext} from "../index";
import {getIndexedAttestationSignatureSet} from "../block/isValidIndexedAttestation";

export function getAttestationsSignatureSets(
  epochCtx: EpochContext,
  state: phase0.BeaconState,
  signedBlock: phase0.SignedBeaconBlock
): ISignatureSet[] {
  return readOnlyMap(signedBlock.message.body.attestations, (attestation) =>
    getIndexedAttestationSignatureSet(epochCtx, state, epochCtx.getIndexedAttestation(attestation))
  );
}
