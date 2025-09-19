import {KeystoreStr} from "@lodestar/api/keymanager";
import {LocalKeystoreDefinition} from "../interface.js";

export type DecryptKeystoreWorkerAPI = {
  decryptKeystore(args: DecryptKeystoreArgs): Promise<Uint8Array>;
};

export type DecryptKeystoreArgs = LocalKeystoreDefinition | {keystoreStr: KeystoreStr; password: string};

export function isLocalKeystoreDefinition(args: DecryptKeystoreArgs): args is LocalKeystoreDefinition {
  return (args as LocalKeystoreDefinition).keystorePath !== undefined;
}
