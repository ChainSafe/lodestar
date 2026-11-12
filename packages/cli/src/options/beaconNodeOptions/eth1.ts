import {CliCommandOptions} from "@lodestar/utils";

/**
 * @deprecated These options are no longer used since eth1 deposit tracking was removed.
 */
export type Eth1Args = {
  /** @deprecated */
  eth1?: boolean;
  /** @deprecated */
  "eth1.providerUrls"?: string[];
  /** @deprecated */
  "eth1.depositContractDeployBlock"?: number;
  /** @deprecated */
  "eth1.disableEth1DepositDataTracker"?: boolean;
  /** @deprecated */
  "eth1.unsafeAllowDepositDataOverwrite"?: boolean;
  /** @deprecated */
  "eth1.forcedEth1DataVote"?: string;
};

/**
 * @deprecated These options are no longer used since eth1 deposit tracking was removed.
 */
export const options: CliCommandOptions<Eth1Args> = {
  eth1: {
    hidden: true,
    deprecated: true,
    description: "Whether to follow the eth1 chain",
    type: "boolean",
    group: "eth1",
  },

  "eth1.providerUrls": {
    hidden: true,
    deprecated: true,
    description:
      "Urls to Eth1 node with enabled rpc. If not explicitly provided and execution endpoint provided via execution.urls, it will use execution.urls. Otherwise will try connecting on the specified default(s)",
    type: "array",
    string: true,
    coerce: (urls: string[]): string[] =>
      // Parse ["url1,url2"] to ["url1", "url2"]
      urls.flatMap((item) => item.split(",")),
    group: "eth1",
  },

  "eth1.depositContractDeployBlock": {
    hidden: true,
    deprecated: true,
    description: "Block number at which the deposit contract contract was deployed",
    type: "number",
    group: "eth1",
  },

  "eth1.disableEth1DepositDataTracker": {
    hidden: true,
    deprecated: true,
    description: "Disable Eth1DepositDataTracker modules",
    type: "boolean",
    group: "eth1",
  },

  "eth1.unsafeAllowDepositDataOverwrite": {
    hidden: true,
    deprecated: true,
    description:
      "Allow the deposit tracker to overwrite previously fetched and saved deposit event data. Warning!!! This is an unsafe operation, so enable this flag only if you know what you are doing.",
    type: "boolean",
    group: "eth1",
  },

  "eth1.forcedEth1DataVote": {
    hidden: true,
    deprecated: true,
    description: "Vote for a specific eth1_data regardless of all conditions. Hex encoded ssz serialized Eth1Data type",
    type: "string",
    group: "eth1",
  },
};
