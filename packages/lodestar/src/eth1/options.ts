export interface IEth1Options {
  enabled: boolean;
  providerUrls: string[];
  depositContractDeployBlock: number;
}

export const defaultEth1Options: IEth1Options = {
  enabled: true,
  providerUrls: ["http://localhost:8545"],
  depositContractDeployBlock: 0,
};
