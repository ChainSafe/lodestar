export interface Eth1ProviderOpts {
  providerUrls?: string[];
  /**
   * jwtSecretHex is the jwt secret if the eth1 modules should ping the jwt auth
   * protected engine endpoints.
   */
  jwtSecretHex?: string;
  depositContractDeployBlock?: number;
}

export interface Eth1Options extends Eth1ProviderOpts {
  enabled?: boolean;
  disableEth1DepositDataTracker?: boolean;
  unsafeAllowDepositDataOverwrite?: boolean;
  /**
   * Vote for a specific eth1_data regardless of validity and existing votes.
   * hex encoded ssz serialized Eth1Data type.
   */
  forcedEth1DataVote?: string;
}

export const defaultEth1Options: Required<Pick<Eth1Options, "enabled" | "providerUrls">> = {
  enabled: true,
  providerUrls: ["http://localhost:8545"],
};
