import {CliCommandOptions} from "@lodestar/utils";
import {DEFAULT_PROXY_REQUEST_TIMEOUT} from "../../../constants.js";
import {LCTransport} from "../../../interfaces.js";
import {alwaysAllowedMethods} from "../../../utils/process.js";

export type StartArgs = {
  port: number;
  executionRpcUrl: string;
  beaconUrls: string[];
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
} & {transport: LCTransport.Rest; urls: string[]};

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
    description: "Urls of the beacon nodes to connect to.",
    type: "array",
    string: true,
    coerce: (urls: string[]): string[] =>
      // Parse ["url1,url2"] to ["url1", "url2"]
      urls
        .map((item) => item.split(","))
        .flat(),
    demandOption: true,
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
  // Remove undefined values to allow deepmerge to inject default values downstream
  return {
    port: args.port,
    executionRpcUrl: args.executionRpcUrl,
    transport: LCTransport.Rest,
    urls: args.beaconUrls ?? [],
    wsCheckpoint: args.wsCheckpoint,
    unverifiedWhitelist: args.unverifiedWhitelist,
    requestTimeout: args.requestTimeout ?? DEFAULT_PROXY_REQUEST_TIMEOUT,
  };
}
