import fs from "fs";
import {fromHexString, toHexString} from "@chainsafe/ssz";
import {interopSecretKey} from "../../src";

const interopPubkeysCachedPath = "interop-pubkeys.json";

export function interopPubkeysCached(validatorCount: number): Uint8Array[] {
  const cachedKeysHex = JSON.parse(fs.readFileSync(interopPubkeysCachedPath, "utf8")) as string[];
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
