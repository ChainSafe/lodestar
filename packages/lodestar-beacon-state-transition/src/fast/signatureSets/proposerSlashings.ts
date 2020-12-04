import {readOnlyMap} from "@chainsafe/ssz";
import {BeaconState, SignedBeaconBlock} from "@chainsafe/lodestar-types";
import {ISignatureSet} from "./types";
import {EpochContext} from "../index";
import {getProposerSlashingSignatureSets} from "../block/processProposerSlashing";

export function getProposerSlashingsSignatureSets(
  epochCtx: EpochContext,
  state: BeaconState,
  signedBlock: SignedBeaconBlock
): ISignatureSet[] {
  return readOnlyMap(signedBlock.message.body.proposerSlashings, (proposerSlashing) =>
    getProposerSlashingSignatureSets(epochCtx, state, proposerSlashing)
  ).flat(1);
}
