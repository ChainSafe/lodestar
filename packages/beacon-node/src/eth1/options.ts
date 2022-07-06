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
};

export const defaultEth1Options: Eth1Options = {
  enabled: true,
  providerUrls: ["http://localhost:8545"],
  depositContractDeployBlock: 0,
  unsafeAllowDepositDataOverwrite: false,
};
