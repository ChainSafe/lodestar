import {readOnlyMap} from "@chainsafe/ssz";
import {SignedBeaconBlock} from "@chainsafe/lodestar-types";
import {ISignatureSet} from "./types";
import {getVoluntaryExitSignatureSet} from "../block/processVoluntaryExit";
import {CachedBeaconState} from "../util/cachedBeaconState";

export function getVoluntaryExitsSignatureSets(
  cachedState: CachedBeaconState,
  signedBlock: SignedBeaconBlock
): ISignatureSet[] {
  return readOnlyMap(signedBlock.message.body.voluntaryExits, (voluntaryExit) =>
    getVoluntaryExitSignatureSet(cachedState, voluntaryExit)
  );
}
