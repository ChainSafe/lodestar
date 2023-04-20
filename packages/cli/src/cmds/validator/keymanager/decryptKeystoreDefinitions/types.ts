import {Logger} from "@lodestar/utils";
import {LocalKeystoreDefinition} from "../interface.js";

export type DecryptKeystoreWorkerAPI = {
  decryptKeystoreDefinition({keystorePath, password}: LocalKeystoreDefinition): Promise<Uint8Array>;
};

export type KeystoreDecryptOptions = {
  ignoreLockFile?: boolean;
  onDecrypt?: (index: number) => void;
  // Try to use the cache file if it exists
  cacheFilePath?: string;
  logger: Pick<Logger, "info" | "warn" | "debug">;
};
