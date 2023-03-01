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
