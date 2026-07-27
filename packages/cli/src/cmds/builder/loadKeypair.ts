import fs from "node:fs";
import {Keystore} from "@chainsafe/bls-keystore";
import {SecretKey} from "@chainsafe/blst";
import {Keypair} from "@lodestar/builder";
import {ensure0xPrefix} from "../../util/format.js";
import {readPassphraseFile} from "../../util/passphrase.js";

export async function loadBuilderKeypair(
  keystorePath: string,
  passwordPath: string,
  expectedPubkey?: string
): Promise<Keypair> {
  const password = readPassphraseFile(passwordPath);
  const keystoreStr = fs.readFileSync(keystorePath, "utf8");
  const keystore = Keystore.parse(keystoreStr);

  if (!(await keystore.verifyPassword(password))) {
    throw Error(`Invalid password for keystore ${keystorePath}`);
  }

  const secretKeyBytes = await keystore.decrypt(password);
  const secretKey = SecretKey.fromBytes(secretKeyBytes);

  const publicKey = secretKey.toPublicKey();
  const publicKeyHex = publicKey.toHex();

  if (expectedPubkey && publicKeyHex !== ensure0xPrefix(expectedPubkey.toLowerCase())) {
    throw Error(`Pubkey mismatch: keystore ${publicKeyHex}, expected ${expectedPubkey}`);
  }

  return {secretKey, publicKey};
}
