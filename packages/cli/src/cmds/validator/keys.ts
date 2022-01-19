import fs from "fs";
import path from "path";
import {Keystore} from "@chainsafe/bls-keystore";
import {CoordType, PublicKey, SecretKey} from "@chainsafe/bls";
import {deriveEth2ValidatorKeys, deriveKeyFromMnemonic} from "@chainsafe/bls-keygen";
import {interopSecretKey} from "@chainsafe/lodestar-beacon-state-transition";
import {remoteSignerGetKeys} from "@chainsafe/lodestar-validator";
import {defaultNetwork, IGlobalArgs} from "../../options";
import {parseRange, stripOffNewlines, YargsError} from "../../util";
import {getLockFile} from "../../util/lockfile";
import {ValidatorDirManager} from "../../validatorDir";
import {getAccountPaths} from "../account/paths";
import {IValidatorCliArgs} from "./options";
import {fromHexString} from "@chainsafe/ssz";

const LOCK_FILE_EXT = ".lock";

export async function getLocalSecretKeys(
  args: IValidatorCliArgs & IGlobalArgs
): Promise<{secretKeys: SecretKey[]; unlockSecretKeys?: () => void}> {
  // UNSAFE - ONLY USE FOR TESTNETS. Derive keys directly from a mnemonic
  if (args.fromMnemonic) {
    if (args.network === defaultNetwork) {
      throw new YargsError("fromMnemonic must only be used in testnets");
    }
    if (!args.mnemonicIndexes) {
      throw new YargsError("Must specify mnemonicIndexes with fromMnemonic");
    }

    const masterSK = deriveKeyFromMnemonic(args.fromMnemonic);
    const indexes = parseRange(args.mnemonicIndexes);
    return {
      secretKeys: indexes.map((index) => {
        const {signing} = deriveEth2ValidatorKeys(masterSK, index);
        return SecretKey.fromBytes(signing);
      }),
    };
  }

  // Derive interop keys
  else if (args.interopIndexes) {
    const indexes = parseRange(args.interopIndexes);
    return {secretKeys: indexes.map((index) => interopSecretKey(index))};
  }

  // Import JSON keystores and run
  else if (args.importKeystoresPath) {
    if (!args.importKeystoresPassword) {
      throw new YargsError("Must specify importKeystoresPassword with importKeystoresPath");
    }

    const passphrase = stripOffNewlines(fs.readFileSync(args.importKeystoresPassword, "utf8"));

    const keystorePaths = args.importKeystoresPath.map((filepath) => resolveKeystorePaths(filepath)).flat(1);

    // Create lock files for all keystores
    const lockFile = getLockFile();
    const lockFilePaths = keystorePaths.map((keystorePath) => keystorePath + LOCK_FILE_EXT);

    // Lock all keystores first
    for (const lockFilePath of lockFilePaths) {
      lockFile.lockSync(lockFilePath);
    }

    const secretKeys = await Promise.all(
      keystorePaths.map(async (keystorePath) =>
        SecretKey.fromBytes(await Keystore.parse(fs.readFileSync(keystorePath, "utf8")).decrypt(passphrase))
      )
    );

    return {
      secretKeys,
      unlockSecretKeys: () => {
        for (const lockFilePath of lockFilePaths) {
          lockFile.unlockSync(lockFilePath);
        }
      },
    };
  }

  // Read keys from local account manager
  else {
    const accountPaths = getAccountPaths(args);
    const validatorDirManager = new ValidatorDirManager(accountPaths);
    return {secretKeys: await validatorDirManager.decryptAllValidators({force: args.force})};
  }
}

export type SignerRemote = {
  remoteSignerUrl: string;
  pubkeyHex: string;
};

/**
 * Gets SignerRemote objects from CLI args
 */
export async function getRemoteSigners(args: IValidatorCliArgs & IGlobalArgs): Promise<SignerRemote[]> {
  // Remote keys declared manually with --remoteSignerPublicKeys
  if (args.remoteSignerPublicKeys) {
    if (args.remoteSignerPublicKeys.length === 0) {
      throw new YargsError("remoteSignerPublicKeys is set to an empty list");
    }

    const remoteSignerUrl = args.remoteSignerUrl;
    if (!remoteSignerUrl) {
      throw new YargsError("Must set remoteSignerUrl with remoteSignerPublicKeys");
    }

    assertValidPubkeysHex(args.remoteSignerPublicKeys);
    assertValidRemoteSignerUrl(remoteSignerUrl);
    return args.remoteSignerPublicKeys.map((pubkeyHex) => ({pubkeyHex, remoteSignerUrl}));
  }

  if (args.remoteSignerFetchPubkeys) {
    const remoteSignerUrl = args.remoteSignerUrl;
    if (!remoteSignerUrl) {
      throw new YargsError("Must set remoteSignerUrl with remoteSignerFetchPubkeys");
    }

    const fetchedPubkeys = await remoteSignerGetKeys(remoteSignerUrl);

    assertValidPubkeysHex(fetchedPubkeys);
    return fetchedPubkeys.map((pubkeyHex) => ({pubkeyHex, remoteSignerUrl}));
  }

  return [];
}

/**
 * Only used for logging remote signers grouped by URL
 */
export function groupRemoteSignersByUrl(
  remoteSigners: SignerRemote[]
): {remoteSignerUrl: string; pubkeysHex: string[]}[] {
  const byUrl = new Map<string, {remoteSignerUrl: string; pubkeysHex: string[]}>();

  for (const remoteSigner of remoteSigners) {
    let x = byUrl.get(remoteSigner.remoteSignerUrl);
    if (!x) {
      x = {remoteSignerUrl: remoteSigner.remoteSignerUrl, pubkeysHex: []};
      byUrl.set(remoteSigner.remoteSignerUrl, x);
    }
    x.pubkeysHex.push(remoteSigner.pubkeyHex);
  }

  return Array.from(byUrl.values());
}

/**
 * Ensure pubkeysHex are valid BLS pubkey (validate hex encoding and point)
 */
function assertValidPubkeysHex(pubkeysHex: string[]): void {
  for (const pubkeyHex of pubkeysHex) {
    const pubkeyBytes = fromHexString(pubkeyHex);
    PublicKey.fromBytes(pubkeyBytes, CoordType.jacobian, true);
  }
}

function assertValidRemoteSignerUrl(urlStr: string): void {
  if (!isValidHttpUrl(urlStr)) {
    throw new YargsError(`Invalid remote signer URL ${urlStr}`);
  }
}

function isValidHttpUrl(urlStr: string): boolean {
  let url;
  try {
    url = new URL(urlStr);
  } catch (_) {
    return false;
  }

  return url.protocol === "http:" || url.protocol === "https:";
}

function resolveKeystorePaths(fileOrDirPath: string): string[] {
  if (fs.lstatSync(fileOrDirPath).isDirectory()) {
    return fs
      .readdirSync(fileOrDirPath)
      .map((file) => path.join(fileOrDirPath, file))
      .filter((filepath) => filepath.endsWith(".json"));
  } else {
    return [fileOrDirPath];
  }
}
