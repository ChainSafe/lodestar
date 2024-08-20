import {Keystore} from "@chainsafe/bls-keystore";
import {SecretKey} from "@chainsafe/blst";
import {fromHex} from "@lodestar/utils/node";

/**
 * Compute encrypted keystore from secret keys serialized in hex, with same password
 */
export async function getKeystoresStr(password: string, secretKeys: string[]): Promise<string[]> {
  const keystoresStr: string[] = [];

  for (const secretKey of secretKeys) {
    const sk = fromHex(secretKey);
    const pk = SecretKey.fromBytes(sk).toPublicKey().toBytes();
    const keystore = await Keystore.create(password, sk, pk, "");
    keystoresStr.push(keystore.stringify());
  }

  return keystoresStr;
}
