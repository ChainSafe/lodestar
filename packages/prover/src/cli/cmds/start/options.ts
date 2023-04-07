import {LCTransport} from "../../../interfaces.js";
import {CliCommandOptions} from "../../../utils/command.js";

export type StartArgs = {
  port: number;
  "execution-rpc-url": string;
  transport: "rest" | "p2p";
  "beacon-urls"?: string[];
  "beacon-bootnodes"?: string[];
  "ws-checkpoint"?: string;
};

export type StartOptions = {
  executionRpcUrl: string;
  port: number;
  wsCheckpoint?: string;
} & ({transport: LCTransport.Rest; urls: string[]} | {transport: LCTransport.P2P; bootnodes: string[]});

export const startOptions: CliCommandOptions<StartArgs> = {
  port: {
    description: "Port number to start the proxy.",
    type: "number",
    default: 8080,
  },
  "execution-rpc-url": {
    description: "RPC url for the execution node.",
    type: "string",
  },

  transport: {
    description: "The Light client mode to connect to. 'rest', 'p2p'",
    type: "string",
    choices: ["rest", "p2p"],
  },

  "beacon-urls": {
    description: "The beacon node PRC urls for 'rest' mode.",
    type: "string",
    array: true,
    demandOption: false,
  },

  "beacon-bootnodes": {
    description: "The beacon node PRC urls for 'p2p' mode.",
    type: "string",
    array: true,
    demandOption: false,
  },

  "ws-checkpoint": {
    description:
      "The trusted checkpoint root to start the lightclient. If not provided will initialize from the latest finalized slot. It shouldn't be older than weak subjectivity period",
    type: "string",
  },
};

export function parseStartArgs(args: StartArgs): StartOptions {
  // Remove undefined values to allow deepmerge to inject default values downstream
  return {
    port: args["port"],
    executionRpcUrl: args["execution-rpc-url"],
    transport: args["transport"] === "p2p" ? LCTransport.P2P : LCTransport.Rest,
    urls: args["transport"] === "rest" ? args["beacon-urls"] ?? [] : [],
    bootnodes: args["transport"] === "p2p" ? args["beacon-bootnodes"] ?? [] : [],
    wsCheckpoint: args["ws-checkpoint"],
  };
}
