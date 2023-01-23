import fs from "node:fs";
import path from "node:path";
import bls from "@chainsafe/bls";
import {Keystore} from "@chainsafe/bls-keystore";
import {Signer, SignerType, ProposerConfig} from "@lodestar/validator";
import {DeletionStatus, ImportStatus, PubkeyHex, SignerDefinition} from "@lodestar/api/keymanager";
import {
  getPubkeyHexFromKeystore,
  readPassphraseFile,
  rmdirSyncMaybe,
  unlinkSyncMaybe,
  writeFile600Perm,
  readProposerConfigDir,
} from "../../../util/index.js";
import {lockFilepath} from "../../../util/lockfile.js";
import {IPersistedKeysBackend} from "./interface.js";
import {loadKeystoreCache, writeKeystoreCache} from "./keystoreCache.js";

export {ImportStatus, DeletionStatus};

type PathArgs = {
  keystoresDir: string;
  secretsDir: string;
  remoteKeysDir: string;
  proposerDir: string;
};

export type LocalKeystoreDefinition = {
  keystorePath: string;
  password: string;
};

/**
 * Class to unify read+write of keystores and remoteKeys from disk.
 * Consumers of this class include:
 * - validator cmd: Read all keystores + lock them, and read all remote keys
 * - import cmd: Write keystores
 * - list cmd: Read all keystores
 * - keymanager importKeystores route: Write keystores + lock them
 * - keymanager importRemoteKeys route: Write remote keys
 *
 * This logic ensures no inconsistencies between all methods of read + write.
 * It also ensures that keystores lockfiles are consistent and checked in all code paths.
 *
 * NOTES:
 * - Keystores imported via keymanager API behave the same and import cmd end result.
 * - Logic to scan an external dir for keystores is the same for import cmd and validator cmd.
 * - lockfile locks are not explicitly released. The underlying library handles that automatically
 * - Imported remote key definitions are stored in a separate directory from imported keystores
 */
export class PersistedKeysBackend implements IPersistedKeysBackend {
  constructor(private readonly paths: PathArgs) {}

  writeProposerConfig(pubkeyHex: PubkeyHex, proposerConfig: ProposerConfig | null): void {
    if (!fs.existsSync(this.paths.proposerDir)) {
      // create directory
      fs.mkdirSync(this.paths.proposerDir);
    }

    if (proposerConfig !== null) {
      // if proposerConfig is not empty write or update the json to file
      const {proposerDirPath} = this.getValidatorPaths(pubkeyHex);
      writeFile600Perm(proposerDirPath, JSON.stringify(proposerConfig));
    } else {
      this.deleteProposerConfig(pubkeyHex);
    }
  }

  deleteProposerConfig(pubkeyHex: PubkeyHex): void {
    if (fs.existsSync(this.paths.proposerDir)) {
      const {proposerDirPath} = this.getValidatorPaths(pubkeyHex);
      unlinkSyncMaybe(proposerDirPath);
    }
  }

  readProposerConfigs(): {[index: string]: ProposerConfig} {
    if (!fs.existsSync(this.paths.proposerDir)) {
      return {};
    }
    const proposerConfigs = {};

    for (const pubkey of fs.readdirSync(this.paths.proposerDir)) {
      Object.assign(proposerConfigs, {[pubkey]: readProposerConfigDir(this.paths.proposerDir, pubkey)});
    }
    return proposerConfigs;
  }

  deleteProposerConfigs(): void {
    for (const pubkey of fs.readdirSync(this.paths.proposerDir)) {
      this.deleteProposerConfig(pubkey);
    }
  }

  readAllKeystores(): LocalKeystoreDefinition[] {
    const {keystoresDir} = this.paths;

    if (!fs.existsSync(keystoresDir)) {
      return [];
    }

    const keystoreDefinitions: LocalKeystoreDefinition[] = [];

    for (const pubkey of fs.readdirSync(keystoresDir)) {
      const {dirpath, keystoreFilepath, passphraseFilepath} = this.getValidatorPaths(pubkey);

      if (fs.statSync(dirpath).isDirectory()) {
        keystoreDefinitions.push({
          keystorePath: keystoreFilepath,
          password: readPassphraseFile(passphraseFilepath),
        });
      }
    }

    return keystoreDefinitions;
  }

  writeKeystore({
    keystoreStr,
    password,
    lockBeforeWrite,
    persistIfDuplicate,
  }: {
    keystoreStr: string;
    password: string;
    lockBeforeWrite: boolean;
    persistIfDuplicate: boolean;
  }): boolean {
    // Validate Keystore JSON + pubkey format.
    // Note: while this is currently redundant, it's free to check that format is correct before writting
    const keystore = Keystore.parse(keystoreStr);
    const pubkeyHex = getPubkeyHexFromKeystore(keystore);

    const {dirpath, keystoreFilepath, passphraseFilepath} = this.getValidatorPaths(pubkeyHex);

    // Check if duplicate first.
    // TODO: Check that the content is actually equal. But not naively, the JSON could be formated differently
    if (!persistIfDuplicate && fs.existsSync(keystoreFilepath)) {
      return false;
    }

    // Make dirs before creating the lock
    fs.mkdirSync(this.paths.secretsDir, {recursive: true});
    fs.mkdirSync(dirpath, {recursive: true});

    if (lockBeforeWrite) {
      // Lock before writing keystore
      lockFilepath(keystoreFilepath);
    }

    writeFile600Perm(keystoreFilepath, keystoreStr);
    writeFile600Perm(passphraseFilepath, password);

    return true;
  }

  /** Returns true if some component was actually deleted */
  deleteKeystore(pubkey: PubkeyHex): boolean {
    const {dirpath, keystoreFilepath, passphraseFilepath} = this.getValidatorPaths(pubkey);

    // Attempt to delete everything, retaining each status
    const deletedKeystore = unlinkSyncMaybe(keystoreFilepath);
    const deletedPassphrase = unlinkSyncMaybe(passphraseFilepath);
    const deletedDir = rmdirSyncMaybe(dirpath);

    // TODO: Unlock keystore .lock
    // Note: not really necessary since current lockfile lib does that automatically on process exit

    return deletedKeystore || deletedPassphrase || deletedDir;
  }

  readAllRemoteKeys(): SignerDefinition[] {
    const signerDefinitions: SignerDefinition[] = [];

    if (!fs.existsSync(this.paths.remoteKeysDir)) {
      return [];
    }

    for (const pubkey of fs.readdirSync(this.paths.remoteKeysDir)) {
      const {definitionFilepath} = this.getDefinitionPaths(pubkey);
      signerDefinitions.push(readRemoteSignerDefinition(definitionFilepath));
    }

    return signerDefinitions;
  }

  writeRemoteKey({
    pubkey,
    url,
    persistIfDuplicate,
  }: {
    pubkey: PubkeyHex;
    url: string;
    persistIfDuplicate: boolean;
  }): boolean {
    const {definitionFilepath} = this.getDefinitionPaths(pubkey);

    // Check if duplicate first.
    // TODO: Check that the content is actually equal. But not naively, the JSON could be formated differently
    if (!persistIfDuplicate && fs.existsSync(definitionFilepath)) {
      return false;
    }

    fs.mkdirSync(path.dirname(definitionFilepath), {recursive: true});
    writeRemoteSignerDefinition(definitionFilepath, {
      pubkey,
      url,
      readonly: false,
    });

    return true;
  }

  /** Returns true if it was actually deleted */
  deleteRemoteKey(pubkey: PubkeyHex): boolean {
    const {definitionFilepath} = this.getDefinitionPaths(pubkey);

    // Attempt to delete everything, retaining each status
    return unlinkSyncMaybe(definitionFilepath);
  }

  private getDefinitionPaths(pubkey: PubkeyHex): {definitionFilepath: string} {
    // TODO: Ensure correct formating 0x prefixed

    return {
      definitionFilepath: path.join(this.paths.remoteKeysDir, pubkey),
    };
  }

  private getValidatorPaths(
    pubkey: PubkeyHex
  ): {
    dirpath: string;
    keystoreFilepath: string;
    passphraseFilepath: string;
    proposerDirPath: string;
  } {
    // TODO: Ensure correct formating 0x prefixed

    const dirpath = path.join(this.paths.keystoresDir, pubkey);

    return {
      dirpath,
      keystoreFilepath: path.join(dirpath, "voting-keystore.json"),
      passphraseFilepath: path.join(this.paths.secretsDir, pubkey),
      proposerDirPath: path.join(this.paths.proposerDir, pubkey),
    };
  }
}

type KeystoreDecryptOptions = {
  force?: boolean;
  onDecrypt?: (index: number, signer: Signer) => void;
  // Try to use the cache file if it exists
  cacheFilePath?: string;
};

export async function decryptKeystoreDefinitions(
  keystoreDefinitions: LocalKeystoreDefinition[],
  opts: KeystoreDecryptOptions
): Promise<Signer[]> {
  if (opts.cacheFilePath) {
    const keystores: Keystore[] = [];
    const passwords: string[] = [];
    for (const {keystorePath, password} of keystoreDefinitions) {
      keystores.push(Keystore.parse(fs.readFileSync(keystorePath, "utf8")));
      passwords.push(password);
    }
    try {
      const signers = await loadKeystoreCache(opts.cacheFilePath, keystores, passwords);
      if (opts?.onDecrypt) {
        opts?.onDecrypt(signers.length - 1, signers[signers.length - 1]);
      }
      return signers;
    } catch (e) {
      // Some error loading the cache, ignore and invalidate cache
      fs.unlinkSync(opts.cacheFilePath);
    }
  }

  const signers: Signer[] = [];
  const keystores: Keystore[] = [];
  const passwords: string[] = [];
  const secretKeys: Buffer[] = [];

  for (const [index, {keystorePath, password}] of keystoreDefinitions.entries()) {
    try {
      lockFilepath(keystorePath);
    } catch (e) {
      if (opts.force) {
        // Ignore error, maybe log?
      } else {
        throw e;
      }
    }

    const keystore = Keystore.parse(fs.readFileSync(keystorePath, "utf8"));

    // PPS: OOM error issue while decripting validators in parallel
    // https://github.com/ChainSafe/lodestar/issues/4166
    //
    // Below call has been serialized as a hotfix for now as even for 10 vals
    // it causes 2.5GB memory hog, which doesn't go down even when the promise
    // resolves and all validators have been decrypted.
    //
    // return await Promise.all(validators.map(async (validator) =>
    //  validator.votingKeypair(this.secretsDir)));
    //
    // The new serialized decryption takes full 5 minutes to decrypt 100 validators
    // on a 100% single core engagement! This needs to be invesigated deeply and
    // fixed most prefered to the above `Promise.all(...)` flow
    //
    const secretKeyBytes = await keystore.decrypt(password);

    const signer: Signer = {
      type: SignerType.Local,
      secretKey: bls.SecretKey.fromBytes(secretKeyBytes),
    };

    signers.push(signer);
    keystores.push(keystore);
    passwords.push(password);
    secretKeys.push(secretKeyBytes);

    if (opts?.onDecrypt) {
      opts?.onDecrypt(index, signer);
    }
  }

  if (opts.cacheFilePath) {
    await writeKeystoreCache(opts.cacheFilePath, keystores, passwords, secretKeys);
  }

  return signers;
}

/**
 * Validate SignerDefinition from un-trusted disk file.
 * Performs type validation and re-maps only expected properties.
 */
export function readRemoteSignerDefinition(filepath: string): SignerDefinition {
  const remoteSignerStr = fs.readFileSync(filepath, "utf8");
  const remoteSignerJson = JSON.parse(remoteSignerStr) as SignerDefinition;
  if (typeof remoteSignerJson.pubkey !== "string") throw Error(`invalid SignerDefinition.pubkey ${filepath}`);
  if (typeof remoteSignerJson.url !== "string") throw Error(`invalid SignerDefinition.url ${filepath}`);
  return {
    pubkey: remoteSignerJson.pubkey,
    url: remoteSignerJson.url,
    readonly: false,
  };
}

/**
 * Re-map all properties to ensure they are defined.
 * To just write `remoteSigner` is not safe since it may contain extra properties too.
 */
export function writeRemoteSignerDefinition(filepath: string, remoteSigner: SignerDefinition): void {
  const remoteSignerJson: SignerDefinition = {
    pubkey: remoteSigner.pubkey,
    url: remoteSigner.url,
    readonly: false,
  };
  writeFile600Perm(filepath, JSON.stringify(remoteSignerJson));
}
