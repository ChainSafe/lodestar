import fs from "node:fs";
import path from "node:path";
import {fromHexString, toHexString} from "@chainsafe/ssz";
import {interopSecretKey} from "../../src/index.js";
import {testCachePath} from "../cache.js";

const interopPubkeysCachedPath = path.join(testCachePath, "interop-pubkeys.json");

export function interopPubkeysCached(validatorCount: number): Uint8Array[] {
  fs.mkdirSync(path.dirname(interopPubkeysCachedPath), {recursive: true});

  const cachedKeysHex = fs.existsSync(interopPubkeysCachedPath)
    ? (JSON.parse(fs.readFileSync(interopPubkeysCachedPath, "utf8")) as string[])
    : ([] as string[]);

  const keys = cachedKeysHex.slice(0, validatorCount).map((hex) => fromHexString(hex));

  if (cachedKeysHex.length < validatorCount) {
    for (let i = cachedKeysHex.length; i < validatorCount; i++) {
      const sk = interopSecretKey(i);
      const pk = sk.toPublicKey().toBytes();
      keys.push(pk);
    }
    const keysHex = keys.map((pk) => toHexString(pk));
    fs.writeFileSync(interopPubkeysCachedPath, JSON.stringify(keysHex, null, 2));
  }

  return keys;
}
