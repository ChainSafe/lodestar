import {Options} from "yargs";
import defaultOptions from "@chainsafe/lodestar/lib/node/options";

export const eth1Options = {
  "eth1.enabled": {
    description: "Whether to follow the eth1 chain",
    type: "boolean",
    defaultDescription: String(defaultOptions.eth1.enabled),
    group: "eth1",
  } as Options,

  "eth1.providerUrl": {
    description: "Url to Eth1 node with enabled rpc",
    type: "string",
    defaultDescription: defaultOptions.eth1.providerUrl,
    group: "eth1",
  } as Options,

  "eth1.depositContractDeployBlock": {
    description: "Block number at which the deposit contract contract was deployed",
    type: "number",
    defaultDescription: String(defaultOptions.eth1.depositContractDeployBlock),
    group: "eth1",
  } as Options,
};
