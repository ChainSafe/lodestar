import {ELRequestHandler} from "./interfaces.js";

export interface ELRequestPayload<T = unknown[]> {
  readonly jsonrpc: string | ("2.0" | "1.0");
  readonly id: number | string;
  readonly method: string;
  readonly params: T;
  readonly requestOptions?: unknown;
}

export type ELResponseWithResult<T> = {
  readonly id: number | string;
  jsonrpc: string;
  result: T;
  error?: never;
};

export type ELResponseWithError<T> = {
  readonly id: number | string;
  jsonrpc: string;
  result?: never;
  error: {
    readonly code?: number;
    readonly data?: T;
    readonly message: string;
  };
};

// Make the very flexible el response type to match different libraries easily
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ELResponse<T = any, E = any> = ELResponseWithResult<T> | ELResponseWithError<E>;

export type HexString = string;

export type ELBlockNumberOrTag = number | string | "latest" | "earliest" | "pending";

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
  readonly data?: string;
}

export interface ELWithdrawal {
  readonly index: string;
  readonly validatorIndex: string;
  readonly address: string;
  readonly amount: string;
}

export interface ELBlock {
  readonly parentHash: string;
  readonly stateRoot: string;
  readonly receiptsRoot: string;
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
  readonly transactionsRoot: string;
  readonly withdrawals?: ELWithdrawal[];
  readonly withdrawalsRoot?: string;
}

export interface ELAccessList {
  readonly address: HexString;
  readonly storageKeys: HexString[];
}

export interface ELAccessListResponse {
  readonly error: string;
  readonly gasUsed: HexString;
  readonly accessList: ELAccessList[];
}

export type ELStorageProof = Pick<ELProof, "storageHash" | "storageProof">;

/* eslint-disable @typescript-eslint/naming-convention */
export type ELApi = {
  eth_createAccessList: (transaction: ELTransaction, block?: ELBlockNumberOrTag) => ELAccessListResponse;
  eth_call: (transaction: ELTransaction, block?: ELBlockNumberOrTag) => HexString;
  eth_estimateGas: (transaction: ELTransaction, block?: ELBlockNumberOrTag) => HexString;
  eth_getCode: (address: string, block?: ELBlockNumberOrTag) => HexString;
  eth_getProof: (address: string, storageKeys: string[], block?: ELBlockNumberOrTag) => ELProof;
  eth_getBlockByNumber: (block: ELBlockNumberOrTag, hydrated?: boolean) => ELBlock | undefined;
  eth_getBlockByHash: (block: string, hydrated?: boolean) => ELBlock | undefined;
};
export type ELApiParams = {
  [K in keyof ELApi]: Parameters<ELApi[K]>;
};
export type ELApiReturn = {
  [K in keyof ELApi]: ReturnType<ELApi[K]>;
};
export type ELApiHandlers = {
  [K in keyof ELApi]: ELRequestHandler<ELApiParams[K], ELApiReturn[K]>;
};
/* eslint-enable @typescript-eslint/naming-convention */
