import {readOnlyMap} from "@chainsafe/ssz";
import {phase0} from "@chainsafe/lodestar-types";
import {ISignatureSet} from "./types";
import {EpochContext} from "../util";
import {getVoluntaryExitSignatureSet} from "../block/processVoluntaryExit";

export function getVoluntaryExitsSignatureSets(
  epochCtx: EpochContext,
  state: phase0.BeaconState,
  signedBlock: phase0.SignedBeaconBlock
): ISignatureSet[] {
  return readOnlyMap(signedBlock.message.body.voluntaryExits, (voluntaryExit) =>
    getVoluntaryExitSignatureSet(epochCtx, state, voluntaryExit)
  );
}
