import {BeaconState} from "@lodestar/types";
import {ChainForkConfig} from "@lodestar/config";
import {IBeaconDb} from "../../../db/interface.js";
import {StateArchiveMode} from "../../archiver/interface.js";
import {stateToStateArchive} from "../utils/stateArchive.js";

export async function storeGenesisState(
  state: BeaconState,
  {
    db,
    archiveMode,
    forkConfig,
  }: {
    db: IBeaconDb;
    forkConfig: ChainForkConfig;
    archiveMode: StateArchiveMode;
  }
) {
  if (archiveMode === StateArchiveMode.Frequency) {
    await db.stateArchive.putBinary(state.slot, forkConfig.getForkTypes(state.slot).BeaconState.serialize(state));
  } else {
    await db.stateArchive.put(state.slot, stateToStateArchive(state, forkConfig));
  }
}
