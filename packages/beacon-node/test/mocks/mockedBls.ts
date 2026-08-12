import {IBlsVerifier, SameMessageSignatureSet} from "../../src/chain/bls/index.js";

export class BlsVerifierMock implements IBlsVerifier {
  constructor(private readonly isValidResult: boolean) {}

  async verifySignatureSets(): Promise<boolean> {
    return this.isValidResult;
  }

  async verifySignatureSetsSameMessage(sets: SameMessageSignatureSet[]): Promise<boolean[]> {
    return sets.map(() => this.isValidResult);
  }

  async close(): Promise<void> {
    //
  }

  canAcceptWork(): boolean {
    return true;
  }
}
