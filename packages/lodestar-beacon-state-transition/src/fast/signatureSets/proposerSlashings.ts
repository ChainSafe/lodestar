import {readOnlyMap} from "@chainsafe/ssz";
import {BeaconState, SignedBeaconBlock} from "@chainsafe/lodestar-types";
import {ISignatureSet} from "./types";
import {EpochContext} from "../index";
import {getProposerSlashingSignatureSets} from "../block/processProposerSlashing";
import {flatten} from "./util";

export function getProposerSlashingsSignatureSets(
  epochCtx: EpochContext,
  state: BeaconState,
  signedBlock: SignedBeaconBlock
): ISignatureSet[] {
  return flatten(
    readOnlyMap(signedBlock.message.body.proposerSlashings, (proposerSlashing) =>
      getProposerSlashingSignatureSets(epochCtx, state, proposerSlashing)
    )
  );
}
