import fs from "node:fs";
import bls from "@chainsafe/bls";
import {Keystore} from "@chainsafe/bls-keystore";
import {SignerLocal, SignerType} from "@lodestar/validator";
import {fromHex, toHex} from "@lodestar/utils";
import {PointFormat} from "@chainsafe/bls/types";
import {lockFilepath, unlockFilepath} from "../../../util/lockfile.js";
import {LocalKeystoreDefinition} from "./interface.js";

export async function loadKeystoreCache(
  cacheFilepath: string,
  keystoreDefinitions: LocalKeystoreDefinition[]
): Promise<SignerLocal[]> {
  const keystores: Keystore[] = [];
  const passwords: string[] = [];
  for (const {keystorePath, password} of keystoreDefinitions) {
    keystores.push(Keystore.parse(fs.readFileSync(keystorePath, "utf8")));
    passwords.push(password);
  }

  if (keystores.length !== passwords.length) {
    throw new Error(
      `Number of keystores and passwords must be equal. keystores=${keystores.length}, passwords=${passwords.length}`
    );
  }

  if (!fs.existsSync(cacheFilepath)) {
    throw new Error(`Cache file ${cacheFilepath} does not exists.`);
  }

  lockFilepath(cacheFilepath);

  const password = passwords.join("");
  // We can't use Keystore.parse as it validates the `encrypted message` to be only 32 bytes.
  const keystore = new Keystore(JSON.parse(fs.readFileSync(cacheFilepath, "utf8")));
  const secretKeyConcatenatedBytes = await keystore.decrypt(password);

  const result: SignerLocal[] = [];
  for (const [index, k] of keystores.entries()) {
    const secretKeyBytes = Uint8Array.prototype.slice.call(secretKeyConcatenatedBytes, index * 32, (index + 1) * 32);
    const secretKey = bls.SecretKey.fromBytes(secretKeyBytes);
    const publicKey = secretKey.toPublicKey().toBytes(PointFormat.compressed);

    if (toHex(publicKey) !== toHex(fromHex(k.pubkey))) {
      throw new Error(
        `Keystore ${k.uuid} does not match the expected pubkey. expected=${toHex(fromHex(k.pubkey))}, found=${toHex(
          publicKey
        )}`
      );
    }

    result.push({
      type: SignerType.Local,
      secretKey,
    });
  }

  unlockFilepath(cacheFilepath);

  return result;
}

export async function writeKeystoreCache(
  cacheFilepath: string,
  signers: SignerLocal[],
  passwords: string[]
): Promise<void> {
  if (signers.length !== passwords.length) {
    throw new Error(
      `Number of signers and passwords must be equal. signers=${signers.length}, passwords=${passwords.length}`
    );
  }
  const secretKeys = signers.map((s) => s.secretKey.toBytes());
  const publicKeys = signers.map((s) => s.secretKey.toPublicKey().toBytes());
  const password = passwords.join("");
  const secretKeyConcatenatedBytes = Buffer.concat(secretKeys);
  const publicConcatenatedBytes = Buffer.concat(publicKeys);
  const keystore = await Keystore.create(password, secretKeyConcatenatedBytes, publicConcatenatedBytes, cacheFilepath);
  lockFilepath(cacheFilepath);
  fs.writeFileSync(cacheFilepath, keystore.stringify());
  unlockFilepath(cacheFilepath);
}

export async function clearKeystoreCache(cacheFilepath: string): Promise<void> {
  if (fs.existsSync(cacheFilepath)) {
    unlockFilepath(cacheFilepath);
    fs.unlinkSync(cacheFilepath);
  }
}
