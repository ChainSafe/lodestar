import {CliCommand, CliCommandOptions} from "../../util/index.js";
import {GlobalArgs} from "../../options/index.js";
import {bootnodeOptions, BootnodeArgs} from "./options.js";
import {bootnodeHandler} from "./handler.js";

export const beacon: CliCommand<BootnodeArgs, GlobalArgs> = {
  command: "bootnode",
  describe:
    "Start a discv5 bootnode. This will NOT perform any beacon node functions, rather, it will run a discv5 service that allows nodes on the network to discover one another.",
  options: bootnodeOptions as CliCommandOptions<BootnodeArgs>,
  handler: bootnodeHandler,
};
