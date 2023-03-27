import {CliCommand, CliCommandOptions} from "../../../utils/command.js";
import {GlobalArgs} from "../../options.js";
import {proverProxyStartHandler} from "./handler.js";
import {StartArgs, startOptions} from "./options.js";

export const proverProxyStartCommand: CliCommand<StartArgs, GlobalArgs> = {
  command: "start",
  describe: "Start proxy server",
  examples: [
    {
      command:
        "start --network sepolia --execution-rpc https://lodestar-sepoliarpc.chainsafe.io --mode rest --beacon-rpc https://lodestar-sepolia.chainsafe.io",
      description: "Start a proxy server and connect to the sepolia testnet",
    },
  ],
  options: startOptions as CliCommandOptions<StartArgs>,
  handler: proverProxyStartHandler,
};
