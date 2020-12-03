import {readOnlyMap} from "@chainsafe/ssz";
import {BeaconState, SignedBeaconBlock} from "@chainsafe/lodestar-types";
import {ISignatureSet} from "./types";
import {EpochContext} from "../index";
import {getIndexedAttestationSignatureSet} from "../block/isValidIndexedAttestation";
import {flatten} from "./util";

export function getAttesterSlashingsSignatureSets(
  epochCtx: EpochContext,
  state: BeaconState,
  signedBlock: SignedBeaconBlock
): ISignatureSet[] {
  return flatten(
    readOnlyMap(signedBlock.message.body.attesterSlashings, (attesterSlashing) =>
      [attesterSlashing.attestation1, attesterSlashing.attestation2].map((attestation) =>
        getIndexedAttestationSignatureSet(epochCtx, state, attestation)
      )
    )
  );
}
