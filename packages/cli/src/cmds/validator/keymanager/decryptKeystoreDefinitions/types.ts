import {Logger} from "@lodestar/utils";
import {LocalKeystoreDefinition} from "../interface.js";

export type DecryptKeystoreWorkerAPI = {
  decryptKeystoreDefinition({keystorePath, password}: LocalKeystoreDefinition, force: boolean): Promise<Uint8Array>;
};

export type KeystoreDecryptOptions = {
  force?: boolean;
  onDecrypt?: (index: number) => void;
  // Try to use the cache file if it exists
  cacheFilePath?: string;
  logger: Pick<Logger, "info">;
};
