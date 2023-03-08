import {NetworkName, networksChainConfig} from "@lodestar/config/networks";
import {LightNode} from "../../../interfaces.js";
import {CliCommandOptions} from "../../../utils/command.js";

export type StartArgs = {
  port: number;
  network: string;
  "execution-rpc": string;
  mode: "rest" | "p2p";
  "beacon-rpc"?: string[];
  "beacon-bootnode"?: string[];
};

export type StartOptions = {
  network: NetworkName;
  executionRpcUrl: string;
  port: number;
  mode: LightNode;
  beaconRpcUrls: string[];
  beaconBootNodes: string[];
};

export const startOptions: CliCommandOptions<StartArgs> = {
  port: {
    description: "Port number to start the proxy.",
    type: "number",
    default: 8080,
  },

  network: {
    description: "Specify the network to connect.",
    type: "string",
    choices: Object.keys(networksChainConfig),
  },

  "execution-rpc": {
    description: "RPC url for the execution node.",
    type: "string",
  },

  mode: {
    description: "The Light client mode to connect to. 'rest', 'p2p'",
    type: "string",
    choices: ["rest", "p2p"],
  },

  "beacon-rpc": {
    description: "The beacon node PRC urls for 'rest' mode.",
    type: "string",
    array: true,
    demandOption: false,
  },

  "beacon-bootnode": {
    description: "The beacon node PRC urls for 'p2p' mode.",
    type: "string",
    array: true,
    demandOption: false,
  },
};

export function parseStartArgs(args: StartArgs): StartOptions {
  // Remove undefined values to allow deepmerge to inject default values downstream
  return {
    port: args["port"],
    network: args["network"] as NetworkName,
    executionRpcUrl: args["execution-rpc"],
    mode: args["mode"] === "p2p" ? LightNode.P2P : LightNode.Rest,
    beaconRpcUrls: args["mode"] === "rest" ? args["beacon-rpc"] ?? [] : [],
    beaconBootNodes: args["mode"] === "p2p" ? args["beacon-bootnode"] ?? [] : [],
  };
}
