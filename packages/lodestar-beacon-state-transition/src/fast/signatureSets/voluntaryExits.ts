import {readOnlyMap} from "@chainsafe/ssz";
import {BeaconState, SignedBeaconBlock} from "@chainsafe/lodestar-types";
import {ISignatureSet} from "./types";
import {EpochContext} from "../index";
import {getVoluntaryExitSignatureSet} from "../block/processVoluntaryExit";

export function getVoluntaryExitsSignatureSets(
  epochCtx: EpochContext,
  state: BeaconState,
  signedBlock: SignedBeaconBlock
): ISignatureSet[] {
  return readOnlyMap(signedBlock.message.body.voluntaryExits, (voluntaryExit) =>
    getVoluntaryExitSignatureSet(epochCtx, state, voluntaryExit)
  );
}
