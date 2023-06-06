import {LCTransport} from "../../../interfaces.js";
import {CliCommandOptions} from "../../../utils/command.js";
import {alwaysAllowedMethods} from "../../../utils/process.js";

export type StartArgs = {
  port: number;
  executionRpcUrl: string;
  transport: "rest" | "p2p";
  beaconUrls?: string[];
  beaconBootnodes?: string[];
  wsCheckpoint?: string;
  unverifiedWhitelist?: string;
};

export type StartOptions = {
  executionRpcUrl: string;
  port: number;
  wsCheckpoint?: string;
  unverifiedWhitelist?: string[];
} & ({transport: LCTransport.Rest; urls: string[]} | {transport: LCTransport.P2P; bootnodes: string[]});

export const startOptions: CliCommandOptions<StartArgs> = {
  port: {
    description: "Port number to start the proxy.",
    type: "number",
    default: 8080,
  },
  executionRpcUrl: {
    description: "RPC url for the execution node.",
    type: "string",
  },

  transport: {
    description: "The Light client mode to connect to. 'rest', 'p2p'",
    type: "string",
    choices: ["rest", "p2p"],
  },

  beaconUrls: {
    description: "The beacon node PRC urls for 'rest' mode.",
    type: "string",
    array: true,
    demandOption: false,
  },

  beaconBootnodes: {
    description: "The beacon node PRC urls for 'p2p' mode.",
    type: "string",
    array: true,
    demandOption: false,
  },

  wsCheckpoint: {
    description:
      "The trusted checkpoint root to start the lightclient. If not provided will initialize from the latest finalized slot. It shouldn't be older than weak subjectivity period",
    type: "string",
  },

  unverifiedWhitelist: {
    description: `Comma separated list of methods which are allowed to forward. If not provided, all methods are allowed.  ${alwaysAllowedMethods.join()} are always allowed.`,
    type: "string",
    demandOption: false,
  },
};

export function parseStartArgs(args: StartArgs): StartOptions {
  // Remove undefined values to allow deepmerge to inject default values downstream
  return {
    port: args.port,
    executionRpcUrl: args.executionRpcUrl,
    transport: args.transport === "p2p" ? LCTransport.P2P : LCTransport.Rest,
    urls: args.transport === "rest" ? args.beaconUrls ?? [] : [],
    bootnodes: args.transport === "p2p" ? args.beaconBootnodes ?? [] : [],
    wsCheckpoint: args.wsCheckpoint,
    unverifiedWhitelist: args.unverifiedWhitelist?.split(","),
  };
}
