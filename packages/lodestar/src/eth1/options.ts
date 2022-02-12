export type Eth1Options = {
  enabled: boolean;
  disableEth1DepositDataTracker?: boolean;
  providerUrls: string[];
  depositContractDeployBlock?: number;
  unsafeAllowDepositDataOverwrite: boolean;
};

export const defaultEth1Options: Eth1Options = {
  enabled: true,
  providerUrls: ["http://localhost:8545"],
  depositContractDeployBlock: 0,
  unsafeAllowDepositDataOverwrite: false,
};
