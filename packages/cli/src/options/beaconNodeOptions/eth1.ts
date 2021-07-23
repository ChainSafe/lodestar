import {defaultOptions, IBeaconNodeOptions} from "@chainsafe/lodestar";
import {ICliCommandOptions} from "../../util";

export interface IEth1Args {
  "eth1.enabled": boolean;
  "eth1.providerUrl": string;
  "eth1.providerUrls": string[];
  "eth1.depositContractDeployBlock": number;
}

export function parseArgs(args: IEth1Args): IBeaconNodeOptions["eth1"] {
  return {
    enabled: args["eth1.enabled"],
    providerUrls: args["eth1.providerUrls"] ?? [args["eth1.providerUrl"]],
    depositContractDeployBlock: args["eth1.depositContractDeployBlock"],
  };
}

export const options: ICliCommandOptions<IEth1Args> = {
  "eth1.enabled": {
    description: "Whether to follow the eth1 chain",
    type: "boolean",
    defaultDescription: String(defaultOptions.eth1.enabled),
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
    defaultDescription: JSON.stringify(defaultOptions.eth1.providerUrls),
    group: "eth1",
  },

  "eth1.depositContractDeployBlock": {
    description: "Block number at which the deposit contract contract was deployed",
    type: "number",
    defaultDescription: String(defaultOptions.eth1.depositContractDeployBlock),
    group: "eth1",
  },
};
