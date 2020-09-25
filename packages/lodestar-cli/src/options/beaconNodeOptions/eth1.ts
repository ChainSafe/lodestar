import defaultOptions, {IBeaconNodeOptions} from "@chainsafe/lodestar/lib/node/options";
import {ICliCommandOptions} from "../../util";

export interface IBeaconNodeEth1Args {
  "eth1.enabled": boolean;
  "eth1.providerUrl": string;
  "eth1.depositContractDeployBlock": number;
}

export function toEth1Options(args: IBeaconNodeEth1Args): IBeaconNodeOptions["eth1"] {
  return {
    enabled: args["eth1.enabled"],
    providerUrl: args["eth1.providerUrl"],
    depositContractDeployBlock: args["eth1.depositContractDeployBlock"],
  };
}

export const eth1Options: ICliCommandOptions<IBeaconNodeEth1Args> = {
  "eth1.enabled": {
    description: "Whether to follow the eth1 chain",
    type: "boolean",
    defaultDescription: String(defaultOptions.eth1.enabled),
    group: "eth1",
  },

  "eth1.providerUrl": {
    description: "Url to Eth1 node with enabled rpc",
    type: "string",
    defaultDescription: defaultOptions.eth1.providerUrl,
    group: "eth1",
  },

  "eth1.depositContractDeployBlock": {
    description: "Block number at which the deposit contract contract was deployed",
    type: "number",
    defaultDescription: String(defaultOptions.eth1.depositContractDeployBlock),
    group: "eth1",
  },
};
