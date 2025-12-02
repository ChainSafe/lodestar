import {CliCommand, CliCommandOptions} from "@lodestar/utils";
import {GlobalArgs} from "../../options/index.js";
import {bootnodeHandler} from "./handler.js";
import {BootnodeArgs, bootnodeOptions} from "./options.js";

export const bootnode: CliCommand<BootnodeArgs, GlobalArgs> = {
  command: "bootnode",
  describe:
    "Run a discv5 bootnode. This will NOT perform any beacon node functions, rather, it will run a discv5 service that allows nodes on the network to discover one another.",
  docsFolder: "run/bootnode",
  options: bootnodeOptions as CliCommandOptions<BootnodeArgs>,
  handler: bootnodeHandler,
};
