import {readOnlyMap} from "@chainsafe/ssz";
import {phase0} from "@chainsafe/lodestar-types";
import {ISignatureSet} from "../../../util";
import {CachedBeaconState} from "../util";
import {getVoluntaryExitSignatureSet} from "../block/processVoluntaryExit";

export function getVoluntaryExitsSignatureSets(
  state: CachedBeaconState<phase0.BeaconState>,
  signedBlock: phase0.SignedBeaconBlock
): ISignatureSet[] {
  return readOnlyMap(signedBlock.message.body.voluntaryExits, (voluntaryExit) =>
    getVoluntaryExitSignatureSet(state, voluntaryExit)
  );
}
