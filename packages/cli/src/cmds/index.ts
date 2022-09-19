import {ICliCommand} from "../util/index.js";
import {IGlobalArgs} from "../options/index.js";
import {beacon} from "./beacon/index.js";
import {dev} from "./dev/index.js";
import {validator} from "./validator/index.js";
import {lightclient} from "./lightclient/index.js";
import {discv5} from "./discv5/index.js";

export const cmds: Required<ICliCommand<IGlobalArgs, Record<never, never>>>["subcommands"] = [
  beacon,
  validator,
  lightclient,
  discv5,
  dev,
];
