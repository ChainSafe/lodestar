export type Eth1Options = {
  enabled: boolean;
  providerUrls: string[];
  depositContractDeployBlock: number;
};

export const defaultEth1Options: Eth1Options = {
  enabled: true,
  providerUrls: ["http://localhost:8545"],
  depositContractDeployBlock: 0,
};
