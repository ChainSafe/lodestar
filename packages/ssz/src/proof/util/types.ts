export type GeneralizedIndex = bigint;

// eslint-disable-next-line @typescript-eslint/interface-name-prefix
export interface ClassicProof {
  leaves: Buffer[]; // bit-alphabetic left-to-right sort
  proof: Buffer[];// decreasing order
}

export type BasicProof = Map<GeneralizedIndex, Buffer>;

export type BasicTree = BasicProof;

export interface IProofBuilder<T> {
  add(index: GeneralizedIndex, chunk: Buffer): void;
  proof(): T;
}
