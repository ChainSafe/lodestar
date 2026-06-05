import {fromHexString, toHexString} from "@chainsafe/ssz";
import {CPStateDatastore, checkpointToDatastoreKey} from "../../../../src/chain/stateCache/datastore/index.js";

export function getTestDatastore(fileApisBuffer: Map<string, Uint8Array>): CPStateDatastore {
  const datastore: CPStateDatastore = {
    write: (cp, stateBytes) => {
      const persistentKey = checkpointToDatastoreKey(cp);
      const stringKey = toHexString(persistentKey);
      if (!fileApisBuffer.has(stringKey)) {
        fileApisBuffer.set(stringKey, stateBytes);
      }
      return Promise.resolve(persistentKey);
    },
    remove: (persistentKey) => {
      const stringKey = toHexString(persistentKey);
      if (fileApisBuffer.has(stringKey)) {
        fileApisBuffer.delete(stringKey);
      }
      return Promise.resolve();
    },
    read: (persistentKey) => Promise.resolve(fileApisBuffer.get(toHexString(persistentKey)) ?? null),
    readLatestSafe: async () => {
      const lastKey = Array.from(fileApisBuffer.keys()).at(-1);
      if (!lastKey) {
        return null;
      }
      return fileApisBuffer.get(lastKey) ?? null;
    },
    readKeys: () => Promise.resolve(Array.from(fileApisBuffer.keys()).map((key) => fromHexString(key))),
  };

  return datastore;
}
