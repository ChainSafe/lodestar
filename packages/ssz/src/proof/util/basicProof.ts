/** @module ssz */
import {GeneralizedIndex, BasicProof, IProofBuilder} from "./types";
import {getHelperIndices} from "./multiproof";

export class BasicProofBuilder implements IProofBuilder<BasicProof> {
  private _proof: BasicProof;
  private indices: Set<GeneralizedIndex>;
  public constructor({leaves}: {leaves: GeneralizedIndex[]}) {
    this._proof = new Map();
    this.indices = new Set([
      ...leaves,
      ...getHelperIndices(leaves),
    ]);
  }
  public add(index: GeneralizedIndex, chunk: Buffer): void {
    if (this.indices.has(index)) {
      this._proof.set(index, chunk);
    }
  }
  public proof(): BasicProof {
    return this._proof;
  }
}
