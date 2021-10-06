import {defaultOptions, IBeaconNodeOptions} from "@chainsafe/lodestar";
import {ICliCommandOptions} from "../../util";

export interface IEth1Args {
  "eth1.mode": "rpcClient" | "disabled";
  "eth1.providerUrl": string;
  "eth1.providerUrls": string[];
  "eth1.depositContractDeployBlock": number;
  "eth1.disableEth1DepositDataTracker": boolean;
}

export function parseArgs(args: IEth1Args): IBeaconNodeOptions["eth1"] {
  // Support deprecated flag 'eth1.providerUrl' only if 'eth1.providerUrls' is not defined
  // Safe default to '--eth1.providerUrl' only if it's defined. Prevent returning providerUrls: [undefined]
  let providerUrls = args["eth1.providerUrls"];
  if (!providerUrls && args["eth1.providerUrl"]) {
    providerUrls = [args["eth1.providerUrl"]];
  }

  return {
    mode: args["eth1.mode"],
    providerUrls: providerUrls,
    depositContractDeployBlock: args["eth1.depositContractDeployBlock"],
    disableEth1DepositDataTracker: args["eth1.disableEth1DepositDataTracker"],
  };
}

export const options: ICliCommandOptions<IEth1Args> = {
  "eth1.mode": {
    description: "'rpcClient' to follow the eth1 chain, or 'disable'",
    type: "string",
    defaultDescription: String(defaultOptions.eth1.mode),
    group: "eth1",
  },

  "eth1.providerUrl": {
    description: "[DEPRECATED] Url to Eth1 node with enabled rpc",
    type: "string",
    defaultDescription: "[DEPRECATED]",
    group: "eth1",
  },

  "eth1.providerUrls": {
    description: "Urls to Eth1 node with enabled rpc",
    type: "array",
    defaultDescription: defaultOptions.eth1.mode === "rpcClient" ? defaultOptions.eth1.providerUrls.join(" ") : "",
    group: "eth1",
  },

  "eth1.depositContractDeployBlock": {
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
};
