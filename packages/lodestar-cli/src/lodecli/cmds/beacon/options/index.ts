import {Argv} from "yargs";

import {mergeOptions, canonicalOptions} from "../../../util";
import {IGlobalArgs} from "../../../options";
import {IBeaconFileArgs} from "./beaconFile";

import * as beaconDir from "./beaconDir";
import * as beaconConfig from "./beaconConfig";
import * as beaconFile from "./beaconFile";

// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface IBeaconArgs extends IBeaconFileArgs {
  chain: {
    params: Record<string, unknown>;
  };
}

export function mergeBeaconOptions(yargs: Argv<IGlobalArgs>): Argv<IBeaconArgs> {
  return mergeOptions(mergeOptions(mergeOptions(yargs, beaconDir), beaconConfig), beaconFile);
}
