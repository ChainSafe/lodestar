import {ICliCommand} from "../util/index.js";
import {IGlobalArgs} from "../options/index.js";
import {beacon} from "./beacon/index.js";
import {dev} from "./dev/index.js";
import {validator} from "./validator/index.js";
import {lightclient} from "./lightclient/index.js";
import {gossipsub} from "./gossipsub/index.js";

export const cmds: Required<ICliCommand<IGlobalArgs, Record<never, never>>>["subcommands"] = [
  beacon,
  validator,
  lightclient,
  gossipsub,
  dev,
];
