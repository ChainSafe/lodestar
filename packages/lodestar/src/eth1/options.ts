export interface IEth1Options {
  enabled: boolean;
  providerUrl: string;
  depositContractDeployBlock: number;
}

export const defaultEth1Options: IEth1Options = {
  enabled: true,
  providerUrl: "http://localhost:8545",
  depositContractDeployBlock: 0,
};
