import fs from "node:fs";
import {defaultOptions, IBeaconNodeOptions} from "@lodestar/beacon-node";
import {CliCommandOptions} from "@lodestar/utils";
import {extractJwtHexSecret} from "../../util/index.js";
import {ExecutionEngineArgs} from "./execution.js";

export type Eth1Args = {
  eth1?: boolean;
  "eth1.providerUrls"?: string[];
  "eth1.depositContractDeployBlock"?: number;
  "eth1.disableEth1DepositDataTracker"?: boolean;
  "eth1.unsafeAllowDepositDataOverwrite"?: boolean;
  "eth1.forcedEth1DataVote"?: string;
};

export function parseArgs(args: Eth1Args & Partial<ExecutionEngineArgs>): IBeaconNodeOptions["eth1"] {
  let jwtSecretHex: string | undefined;
  let jwtId: string | undefined;

  let providerUrls = args["eth1.providerUrls"];

  // If no providerUrls are explicitly provided, we should pick the execution endpoint
  // because as per Kiln spec v2.1, execution *must* host the `eth_` methods necessary
  // for deposit and merge trackers on engine endpoints as well protected by a
  // jwt auth mechanism.
  if (providerUrls === undefined && args["execution.urls"]) {
    providerUrls = args["execution.urls"];
    jwtSecretHex = args.jwtSecret ? extractJwtHexSecret(fs.readFileSync(args.jwtSecret, "utf-8").trim()) : undefined;
    jwtId = args.jwtId;
  }

  return {
    enabled: args.eth1,
    providerUrls,
    jwtSecretHex,
    jwtId,
    depositContractDeployBlock: args["eth1.depositContractDeployBlock"],
    disableEth1DepositDataTracker: args["eth1.disableEth1DepositDataTracker"],
    unsafeAllowDepositDataOverwrite: args["eth1.unsafeAllowDepositDataOverwrite"],
    forcedEth1DataVote: args["eth1.forcedEth1DataVote"],
  };
}

export const options: CliCommandOptions<Eth1Args> = {
  eth1: {
    description: "Whether to follow the eth1 chain",
    type: "boolean",
    defaultDescription: String(defaultOptions.eth1.enabled),
    group: "eth1",
  },

  "eth1.providerUrls": {
    description:
      "Urls to Eth1 node with enabled rpc. If not explicitly provided and execution endpoint provided via execution.urls, it will use execution.urls. Otherwise will try connecting on the specified default(s)",
    defaultDescription: defaultOptions.eth1.providerUrls?.join(","),
    type: "array",
    string: true,
    coerce: (urls: string[]): string[] =>
      // Parse ["url1,url2"] to ["url1", "url2"]
      urls.flatMap((item) => item.split(",")),
    group: "eth1",
  },

  "eth1.depositContractDeployBlock": {
    hidden: true,
    description: "Block number at which the deposit contract contract was deployed",
    type: "number",
    defaultDescription: String(defaultOptions.eth1.depositContractDeployBlock),
    group: "eth1",
  },

  "eth1.disableEth1DepositDataTracker": {
    hidden: true,
    description: "Disable Eth1DepositDataTracker modules",
    type: "boolean",
    defaultDescription: String(defaultOptions.eth1.disableEth1DepositDataTracker),
    group: "eth1",
  },

  "eth1.unsafeAllowDepositDataOverwrite": {
    hidden: true,
    description:
      "Allow the deposit tracker to overwrite previously fetched and saved deposit event data. Warning!!! This is an unsafe operation, so enable this flag only if you know what you are doing.",
    type: "boolean",
    defaultDescription: String(defaultOptions.eth1.unsafeAllowDepositDataOverwrite),
    group: "eth1",
  },

  "eth1.forcedEth1DataVote": {
    hidden: true,
    description: "Vote for a specific eth1_data regardless of all conditions. Hex encoded ssz serialized Eth1Data type",
    type: "string",
    group: "eth1",
  },
};
