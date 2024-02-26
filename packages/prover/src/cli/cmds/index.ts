import {CliCommand} from "@lodestar/utils";
import {GlobalArgs} from "../options.js";
import {proverProxyStartCommand} from "./start/index.js";
export {proverProxyStartCommand} from "./start/index.js";

export const cmds: Required<CliCommand<GlobalArgs, Record<never, never>>>["subcommands"] = [proverProxyStartCommand];
