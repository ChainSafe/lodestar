import {readonlyValues} from "@chainsafe/ssz";
import {phase0} from "@chainsafe/lodestar-types";
import {ISignatureSet} from "./types";
import {CachedBeaconState} from "../util";
import {getProposerSlashingSignatureSets} from "../block/processProposerSlashing";

export function getProposerSlashingsSignatureSets(
  state: CachedBeaconState<phase0.BeaconState>,
  signedBlock: phase0.SignedBeaconBlock
): ISignatureSet[] {
  return Array.from(readonlyValues(signedBlock.message.body.proposerSlashings), (proposerSlashing) =>
    getProposerSlashingSignatureSets(state, proposerSlashing)
  ).flat(1);
}
