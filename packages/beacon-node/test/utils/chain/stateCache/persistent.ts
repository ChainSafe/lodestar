import {fromHexString, toHexString} from "@chainsafe/ssz";
import {phase0, ssz} from "@lodestar/types";
import {CPStatePersistentApis, PersistedKey} from "../../../../src/chain/stateCache/persistent/types.js";

export function getTestPersistentApi(fileApisBuffer: Map<string, Uint8Array>): CPStatePersistentApis {
  const persistentApis: CPStatePersistentApis = {
    write: (cp, state) => {
      const persistentKey = checkpointToPersistentKey(cp);
      const stringKey = toHexString(persistentKey);
      if (!fileApisBuffer.has(stringKey)) {
        fileApisBuffer.set(stringKey, state.serialize());
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
    readKeys: () => Promise.resolve(Array.from(fileApisBuffer.keys()).map((key) => fromHexString(key))),
    persistedKeyToCheckpoint: (persistentKey: PersistedKey) => ssz.phase0.Checkpoint.deserialize(persistentKey),
  };

  return persistentApis;
}

export function checkpointToPersistentKey(cp: phase0.Checkpoint): PersistedKey {
  return ssz.phase0.Checkpoint.serialize(cp);
}
