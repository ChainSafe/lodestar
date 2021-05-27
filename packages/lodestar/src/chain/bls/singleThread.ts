import {PublicKey} from "@chainsafe/bls";
import {IBlsVerifierImpl} from "./interface";
import {verifySignatureSetsMaybeBatch} from "./maybeBatch";

export class BlsSingleThreadVerifier implements IBlsVerifierImpl {
  async verifySignatureSets(
    sets: {publicKey: PublicKey; message: Uint8Array; signature: Uint8Array}[],
    validateSignature: boolean
  ): Promise<boolean> {
    return verifySignatureSetsMaybeBatch(sets, validateSignature);
  }
}
