import {Argv} from "yargs";

import {mergeOptions, canonicalOptions} from "../../../util";
import {IGlobalArgs} from "../../../options";
import {IBeaconFileArgs} from "./beaconFile";

import * as api from "./api";
import * as chain from "./chain";
import * as eth1 from "./eth1";
import * as logger from "./logger";
import * as metrics from "./metrics";
import * as network from "./network";

import * as beaconDir from "./beaconDir";
import * as beaconFile from "./beaconFile";

export interface IBeaconArgs extends IBeaconFileArgs {}

export function beaconOptions(yargs: Argv<IGlobalArgs>): Argv<IBeaconArgs> {
  return mergeOptions(mergeOptions(yargs, beaconDir), beaconFile);
}

export const beaconRunOptions = canonicalOptions({
  ...api,
  ...chain,
  ...eth1,
  ...logger,
  ...metrics,
  ...network,
});
