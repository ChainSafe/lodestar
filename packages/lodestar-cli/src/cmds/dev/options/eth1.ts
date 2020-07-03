/**
 * Copied from ../../beacon/cmds/run/options/eth1.ts so we can change default values.
 */

import {Options} from "yargs";

export const eth1Enabled: Options = {
  alias: [
    "eth1.enabled",
  ],
  description: "Whether to follow the eth1 chain",
  type: "boolean",
  default: false,
  group: "eth1",
};

export const eth1ProviderUrl: Options = {
  alias: [
    "eth1.provider.url",
  ],
  description: "Url to Eth1 node with enabled rpc",
  type: "string",
  default: "http://localhost:8545",
  group: "eth1",
};

export const eth1ProviderNetwork: Options = {
  alias: [
    "eth1.provider.network"
  ],
  description: "Eth1 network id",
  type: "number",
  default: 200,
  group: "eth1",
};

export const eth1DepositContractDeployedAt: Options = {
  alias: [
    "eth1.depositContract.deployedAt",
  ],
  description: "Block number at which the deposit contract contract was deployed",
  type: "number",
  default: 0,
  group: "eth1",
};

export const eth1DepositContractAddress: Options = {
  alias: [
    "eth1.depositContract.address",
  ],
  description: "Address of deposit contract",
  type: "string",
  default: "TBD",
  group: "eth1",
};
