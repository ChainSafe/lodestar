export interface ELRequestPayload<T = unknown[]> {
  readonly jsonrpc: string & ("2.0" | "1.0");
  readonly id: number | string;
  readonly method: string;
  readonly params: T;
  readonly requestOptions?: unknown;
}

// Make the very flexible el response type to match different libraries easily
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ELResponse<T = any, E = any> = {
  readonly id: number | string;
  jsonrpc: string;
  result?: T;
  error?: {
    readonly code?: number;
    readonly data?: E;
    readonly message: string;
  };
};
export interface ELProof {
  readonly address: string;
  readonly balance: string;
  readonly codeHash: string;
  readonly nonce: string;
  readonly storageHash: string;
  readonly accountProof: string[];
  readonly storageProof: {
    readonly key: string;
    readonly value: string;
    readonly proof: string[];
  }[];
}

export interface ELTransaction {
  readonly type: string;
  readonly nonce: string;
  readonly to: string | null;
  readonly chainId?: string;
  readonly input: string;
  readonly value: string;
  readonly gasPrice?: string;
  readonly gas: string;
  readonly maxFeePerGas?: string;
  readonly maxPriorityFeePerGas?: string;
  readonly blockHash: string;
  readonly blockNumber: string;
  readonly from: string;
  readonly hash: string;
  readonly r: string;
  readonly s: string;
  readonly v: string;
  readonly transactionIndex: string;
  readonly accessList?: {address: string; storageKeys: string[]}[];
}

export interface ELBlock {
  readonly parentHash: string;
  readonly transactionsRoot: string;
  readonly stateRoot: string;
  readonly receiptsRoot: string;
  readonly withdrawalsRoot: string;
  readonly logsBloom: string;
  readonly nonce: string;
  readonly difficulty: string;
  readonly totalDifficulty: string;
  readonly number: string;
  readonly gasLimit: string;
  readonly gasUsed: string;
  readonly timestamp: string;
  readonly extraData?: Buffer | string;
  readonly mixHash: string;
  readonly hash: string;
  readonly baseFeePerGas: string;
  readonly miner: string;
  readonly sha3Uncles: string;
  readonly size: string;
  readonly uncles: ELBlock[];
  readonly transactions: ELTransaction[];
}
export type ELStorageProof = Pick<ELProof, "storageHash" | "storageProof">;
export type HexString = string;
