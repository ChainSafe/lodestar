export type Eth1Options = {
  enabled: boolean;
  disableEth1DepositDataTracker?: boolean;
  providerUrls: string[];
  /**
   * jwtSecretHex is the jwt secret if the eth1 modules should ping the jwt auth
   * protected engine endpoints.
   */
  jwtSecretHex?: string;
  depositContractDeployBlock?: number;
  unsafeAllowDepositDataOverwrite: boolean;
  /**
   * Vote for a specific eth1_data regardless of validity and existing votes.
   * hex encoded ssz serialized Eth1Data type.
   */
  forcedEth1DataVote?: string;
};

export const defaultEth1Options: Eth1Options = {
  enabled: true,
  providerUrls: ["http://localhost:8545"],
  depositContractDeployBlock: 0,
  unsafeAllowDepositDataOverwrite: false,
};
