export type Eth1HttpOptions = {
  disableEth1DepositDataTracker?: boolean;
  providerUrls?: string[];
  /**
   * jwtSecretHex is the jwt secret if the eth1 modules should ping the jwt auth
   * protected engine endpoints.
   */
  jwtSecretHex?: string;
  jwtId?: string;
  jwtVersion?: string;
  depositContractDeployBlock?: number;
  unsafeAllowDepositDataOverwrite?: boolean;
  /**
   * Vote for a specific eth1_data regardless of validity and existing votes.
   * hex encoded ssz serialized Eth1Data type.
   */
  forcedEth1DataVote?: string;
};

export type Eth1MockOptions = {
  terminalPowBlockNumber: number;
  terminalPowBlockHash: string;
};

export type Eth1Options = ({mode?: "http"} & Eth1HttpOptions) | ({mode: "mock"} & Eth1MockOptions) | {mode: "disabled"};

export const DEFAULT_PROVIDER_URLS = ["http://localhost:8545"];

export const defaultEth1HttpOptions: Eth1HttpOptions = {
  providerUrls: DEFAULT_PROVIDER_URLS,
  depositContractDeployBlock: 0,
  unsafeAllowDepositDataOverwrite: false,
};
