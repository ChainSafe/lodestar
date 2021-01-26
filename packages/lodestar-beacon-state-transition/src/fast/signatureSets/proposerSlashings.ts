import {readOnlyMap} from "@chainsafe/ssz";
import {SignedBeaconBlock} from "@chainsafe/lodestar-types";
import {ISignatureSet} from "./types";
import {getProposerSlashingSignatureSets} from "../block/processProposerSlashing";
import {CachedBeaconState} from "../util/cachedBeaconState";

export function getProposerSlashingsSignatureSets(
  cachedState: CachedBeaconState,
  signedBlock: SignedBeaconBlock
): ISignatureSet[] {
  return readOnlyMap(signedBlock.message.body.proposerSlashings, (proposerSlashing) =>
    getProposerSlashingSignatureSets(cachedState, proposerSlashing)
  ).flat(1);
}
