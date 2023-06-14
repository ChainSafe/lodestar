import {DEFAULT_PROXY_REQUEST_TIMEOUT} from "../../../constants.js";
import {LCTransport} from "../../../interfaces.js";
import {CliCommandOptions} from "../../../utils/command.js";
import {alwaysAllowedMethods} from "../../../utils/process.js";

export type StartArgs = {
  port: number;
  executionRpcUrl: string;
  beaconUrls?: string[];
  beaconBootnodes?: string[];
  wsCheckpoint?: string;
  unverifiedWhitelist?: string[];
  requestTimeout: number;
};

export type StartOptions = {
  executionRpcUrl: string;
  port: number;
  wsCheckpoint?: string;
  unverifiedWhitelist?: string[];
  requestTimeout: number;
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
    demandOption: true,
    group: "execution",
  },

  unverifiedWhitelist: {
    description: `Methods which are allowed to forward. If not provided, all methods are allowed. ${alwaysAllowedMethods.join(
      ","
    )} are always allowed.`,
    type: "array",
    demandOption: false,
    group: "execution",
  },

  requestTimeout: {
    description: "Number of ms to wait for a response from the execution node.",
    default: DEFAULT_PROXY_REQUEST_TIMEOUT,
    type: "number",
    demandOption: false,
    group: "execution",
  },

  beaconUrls: {
    description: "The beacon node PRC urls for 'rest' mode.",
    type: "string",
    array: true,
    conflicts: ["beaconBootnodes"],
    group: "beacon",
  },

  beaconBootnodes: {
    description: "The beacon node PRC urls for 'p2p' mode.",
    type: "string",
    array: true,
    conflicts: ["beaconUrls"],
    group: "beacon",
  },

  wsCheckpoint: {
    description:
      "The trusted checkpoint root to start the lightclient. If not provided will initialize from the latest finalized slot. It shouldn't be older than weak subjectivity period",
    type: "string",
    demandOption: false,
    group: "beacon",
  },
};

export function parseStartArgs(args: StartArgs): StartOptions {
  if (!args.beaconUrls && !args.beaconBootnodes) {
    throw new Error("Either --beaconUrls or --beaconBootnodes must be provided");
  }

  // Remove undefined values to allow deepmerge to inject default values downstream
  return {
    port: args.port,
    executionRpcUrl: args.executionRpcUrl,
    transport: args.beaconUrls ? LCTransport.Rest : LCTransport.P2P,
    urls: args.beaconUrls ?? [],
    bootnodes: args.beaconBootnodes ?? [],
    wsCheckpoint: args.wsCheckpoint,
    unverifiedWhitelist: args.unverifiedWhitelist,
    requestTimeout: args.requestTimeout ?? DEFAULT_PROXY_REQUEST_TIMEOUT,
  };
}
