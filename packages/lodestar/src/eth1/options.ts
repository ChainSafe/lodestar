import {Eth1ProviderMockOpts} from "./provider/eth1Provider/mock";

export type Eth1RpcClient = {
  providerUrls: string[];
};

export type Eth1OptionsMode =
  | ({mode: "rpcClient"} & Eth1RpcClient)
  | ({mode: "mock"} & Eth1ProviderMockOpts)
  | {mode: "disabled"};

export type Eth1Options = Eth1OptionsMode & {
  disableEth1DepositDataTracker?: boolean;
  depositContractDeployBlock?: number;
};

export const defaultEth1Options: Eth1Options = {
  mode: "rpcClient",
  providerUrls: ["http://localhost:8545"],
  depositContractDeployBlock: 0,
};
