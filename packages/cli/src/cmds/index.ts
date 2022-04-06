import {ICliCommand} from "../util/index.js";
import {IGlobalArgs} from "../options/index.js";
import {account} from "./account/index.js";
import {beacon} from "./beacon/index.js";
import {dev} from "./dev/index.js";
import {init} from "./init/index.js";
import {validator} from "./validator/index.js";

export const cmds: Required<ICliCommand<IGlobalArgs, Record<never, never>>>["subcommands"] = [
  beacon,
  validator,
  account,
  init,
  dev,
];
