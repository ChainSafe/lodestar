import {PublicKey} from "@chainsafe/bls/types";
import {IBlsVerifier} from "../../src/chain/bls/index.js";

export class BlsVerifierMock implements IBlsVerifier {
  constructor(private readonly isValidResult: boolean) {}

  async verifySignatureSets(): Promise<boolean> {
    return this.isValidResult;
  }

  async verifySignatureSetsSameMessage(sets: {publicKey: PublicKey; signature: Uint8Array}[]): Promise<boolean[]> {
    return sets.map(() => this.isValidResult);
  }

  async close(): Promise<void> {
    //
  }

  canAcceptWork(): boolean {
    return true;
  }
}
