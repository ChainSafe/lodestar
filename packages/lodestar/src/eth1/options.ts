export interface IEth1Options {
  enabled: boolean;
  providerUrl: string;
  depositContractDeployBlock: number;
}

const config: IEth1Options = {
  enabled: true,
  providerUrl: "http://localhost:8545",
  depositContractDeployBlock: 0,
};

export default config;
