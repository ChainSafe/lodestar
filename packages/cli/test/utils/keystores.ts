import bls from "@chainsafe/bls";
import {Keystore} from "@chainsafe/bls-keystore";
import {fromHex} from "@chainsafe/lodestar-utils";

/**
 * Compute encrypted keystore from secret keys serialized in hex, with same password
 */
export async function getKeystoresStr(password: string, secretKeys: string[]): Promise<string[]> {
  const keystoresStr: string[] = [];

  for (const secretKey of secretKeys) {
    const sk = fromHex(secretKey);
    const pk = bls.SecretKey.fromBytes(sk).toPublicKey().toBytes();
    const keystore = await Keystore.create(password, sk, pk, "");
    keystoresStr.push(keystore.stringify());
  }

  return keystoresStr;
}
