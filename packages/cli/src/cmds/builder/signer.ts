import fs from "node:fs";
import {Keystore} from "@chainsafe/bls-keystore";
import {SecretKey} from "@chainsafe/blst";
import {toPubkeyHex} from "@lodestar/utils";
import {ensure0xPrefix} from "../../util/format.js";
import {readPassphraseFile} from "../../util/passphrase.js";

export async function loadBuilderSigner(
  keystorePath: string,
  passwordPath: string,
  expectedPubkey?: string
): Promise<SecretKey> {
  const password = readPassphraseFile(passwordPath);
  const keystoreStr = fs.readFileSync(keystorePath, "utf8");
  const keystore = Keystore.parse(keystoreStr);

  if (!(await keystore.verifyPassword(password))) {
    throw Error(`Invalid password for keystore ${keystorePath}`);
  }

  const secretKeyBytes = await keystore.decrypt(password);
  const secretKey = SecretKey.fromBytes(secretKeyBytes);

  if (
    expectedPubkey &&
    toPubkeyHex(secretKey.toPublicKey().toBytes()) !== ensure0xPrefix(expectedPubkey.toLowerCase())
  ) {
    throw Error("Pubkey mismatch");
  }

  return secretKey;
}
