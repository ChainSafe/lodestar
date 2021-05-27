import {PublicKey} from "@chainsafe/bls";

export interface IBlsVerifierImpl {
  verifySignatureSets(
    sets: {publicKey: PublicKey; message: Uint8Array; signature: Uint8Array}[],
    validateSignature: boolean
  ): Promise<boolean>;
}
