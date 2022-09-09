import {PubkeyHex, SignerDefinition} from "@lodestar/api/keymanager";
import {ProposerConfig} from "@lodestar/validator";

export type LocalKeystoreDefinition = {
  keystorePath: string;
  password: string;
};

export interface IPersistedKeysBackend {
  readAllKeystores(): LocalKeystoreDefinition[];

  /** Returns true some item is written to disk */
  writeKeystore(args: {
    keystoreStr: string;
    password: string;
    lockBeforeWrite: boolean;
    persistIfDuplicate: boolean;
  }): boolean;

  /** Returns true some item is deleted from disk */
  deleteKeystore(pubkey: PubkeyHex): boolean;

  readAllRemoteKeys(): SignerDefinition[];

  /** Returns true some item is written to disk */
  writeRemoteKey(args: {pubkey: PubkeyHex; url: string; persistIfDuplicate: boolean}): boolean;

  /** Returns true some item is deleted from disk */
  deleteRemoteKey(pubkey: PubkeyHex): boolean;

  writeProposerConfig(pubkey: PubkeyHex, proposerConfig: ProposerConfig | null): void;
  deleteProposerConfig(pubkeyHex: PubkeyHex): void;
  readProposerConfigs(): {[index: string]: ProposerConfig};
  deleteProposerConfigs(): void;
}
