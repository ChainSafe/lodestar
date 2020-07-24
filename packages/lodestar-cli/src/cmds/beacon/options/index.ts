import {Argv} from "yargs";

import {mergeOptions} from "../../../util";
import {IGlobalArgs} from "../../../options";
import {IBeaconFileArgs} from "./beaconFile";

import {beaconDirOptions} from "./beaconDir";
import {beaconConfigOptions} from "./beaconConfig";
import {beaconFileOptions} from "./beaconFile";

export interface IBeaconArgs extends IBeaconFileArgs {
  chain: {
    params: Record<string, unknown>;
    genesisStateFile?: string;
  };
}

export function mergeBeaconOptions(yargs: Argv<IGlobalArgs>): Argv<IBeaconArgs> {
  return mergeOptions(
    mergeOptions(
      mergeOptions(yargs, beaconDir),
      beaconConfig),
    beaconFile
  );
}
