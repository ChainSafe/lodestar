import {readOnlyMap} from "@chainsafe/ssz";
import {phase0} from "@chainsafe/lodestar-types";
import {ISignatureSet} from "./types";
import {EpochContext} from "../util";
import {getProposerSlashingSignatureSets} from "../block/processProposerSlashing";

export function getProposerSlashingsSignatureSets(
  epochCtx: EpochContext,
  state: phase0.BeaconState,
  signedBlock: phase0.SignedBeaconBlock
): ISignatureSet[] {
  return readOnlyMap(signedBlock.message.body.proposerSlashings, (proposerSlashing) =>
    getProposerSlashingSignatureSets(epochCtx, state, proposerSlashing)
  ).flat(1);
}
