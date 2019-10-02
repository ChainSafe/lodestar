/** @module ssz */
import {GeneralizedIndex, BasicProof, IProofBuilder, ClassicProof} from "./types";
import {getHelperIndices} from "./multiproof";

export class ClassicProofBuilder implements IProofBuilder<ClassicProof> {
  private _proof: BasicProof;
  private indices: Set<GeneralizedIndex>;
  private leaves: GeneralizedIndex[];
  private helpers: GeneralizedIndex[];
  public constructor({leaves}: {leaves: GeneralizedIndex[]}) {
    this._proof = new Map();
    this.leaves = leaves;
    this.helpers = getHelperIndices(leaves);
    this.indices = new Set([
      ...this.leaves,
      ...this.helpers,
    ]);
  }
  public add(index: GeneralizedIndex, chunk: Buffer): void {
    if (this.indices.has(index)) {
      this._proof.set(index, chunk);
    }
  }
  public proof(): ClassicProof {
    return {
      leaves: this.leaves.map((i) => this._proof.get(i)),
      proof: this.helpers.map((i) => this._proof.get(i)),
    };
  }
}
