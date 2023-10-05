import {CPStatePersistentApis} from "../../src/chain/stateCache/persistent/types.js";

export function getTestPersistentApi(fileApisBuffer: Map<string, Uint8Array>): CPStatePersistentApis {
  const persistentApis: CPStatePersistentApis = {
    write: (cpKey, bytes) => {
      if (!fileApisBuffer.has(cpKey)) {
        fileApisBuffer.set(cpKey, bytes);
      }
      return Promise.resolve(cpKey);
    },
    remove: (filePath) => {
      if (fileApisBuffer.has(filePath)) {
        fileApisBuffer.delete(filePath);
        return Promise.resolve(true);
      }
      return Promise.resolve(false);
    },
    read: (filePath) => Promise.resolve(fileApisBuffer.get(filePath) || Buffer.alloc(0)),
  };

  return persistentApis;
}
