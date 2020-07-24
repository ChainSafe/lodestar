import {Options} from "yargs";

export const eth1Options = {
  "eth1.enabled": {
    description: "Whether to follow the eth1 chain",
    type: "boolean",
    default: true,
    group: "eth1",
  } as Options,

  "eth1.provider.url": {
    description: "Url to Eth1 node with enabled rpc",
    type: "string",
    default: "http://localhost:8545",
    group: "eth1",
  } as Options,

  "eth1.provider.network": {
    description: "Eth1 network id",
    type: "number",
    default: 200,
    group: "eth1",
  } as Options,

  "eth1.depositContract.deployedAt": {
    description:
      "Block number at which the deposit contract contract was deployed",
    type: "number",
    default: 0,
    group: "eth1",
  } as Options,

  "eth1.depositContract.address": {
    description: "Address of deposit contract",
    type: "string",
    default: "TBD",
    group: "eth1",
  } as Options,
};
