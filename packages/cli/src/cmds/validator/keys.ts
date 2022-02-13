import fs from "node:fs";
import path from "node:path";
import {Keystore} from "@chainsafe/bls-keystore";
import {CoordType, PublicKey, SecretKey} from "@chainsafe/bls";
import {deriveEth2ValidatorKeys, deriveKeyFromMnemonic} from "@chainsafe/bls-keygen";
import {interopSecretKey} from "@chainsafe/lodestar-beacon-state-transition";
import {defaultNetwork, IGlobalArgs} from "../../options";
import {parseRange, stripOffNewlines, YargsError} from "../../util";
import {getLockFile, LOCK_FILE_EXT} from "../../util/lockfile";
import {ValidatorDirManager} from "../../validatorDir";
import {getAccountPaths} from "../account/paths";
import {IValidatorCliArgs} from "./options";
import {fromHexString} from "@chainsafe/ssz";
import {externalSignerGetKeys, SecretKeyInfo} from "@chainsafe/lodestar-validator";
import {SignerRemote, SignerType} from "@chainsafe/lodestar-validator";

const depositDataPattern = new RegExp(/^deposit_data-\d+\.json$/gi);

export async function getLocalSecretKeys(args: IValidatorCliArgs & IGlobalArgs): Promise<SecretKeyInfo[]> {
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

    return indexes.map((index) => {
      const {signing} = deriveEth2ValidatorKeys(masterSK, index);
      return {secretKey: SecretKey.fromBytes(signing)};
    });
  } else if (args.interopIndexes) {
    // Derive interop keys
    const indexes = parseRange(args.interopIndexes);

    return indexes.map((index) => {
      return {secretKey: interopSecretKey(index)};
    });
  } else if (args.importKeystoresPath) {
    // Import JSON keystores and run
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

    const secretKeysInfo: SecretKeyInfo[] = await Promise.all(
      keystorePaths.map(async (keystorePath) => {
        const secretKey = SecretKey.fromBytes(
          await Keystore.parse(fs.readFileSync(keystorePath, "utf8")).decrypt(passphrase)
        );
        return {
          secretKey,
          keystorePath,
          unlockSecretKeys: () => {
            lockFile.unlockSync(keystorePath + LOCK_FILE_EXT);
          },
        };
      })
    );

    return secretKeysInfo;
  } else {
    // Read keys from local account manager
    const accountPaths = getAccountPaths(args);
    const validatorDirManager = new ValidatorDirManager(accountPaths);
    const secretKeys: SecretKey[] = await validatorDirManager.decryptAllValidators({force: args.force});
    return secretKeys.map((secretKey) => {
      return {secretKey};
    });
  }
}

/**
 * Gets SignerRemote objects from CLI args
 */
export async function getExternalSigners(args: IValidatorCliArgs & IGlobalArgs): Promise<SignerRemote[]> {
  // Remote keys declared manually with --externalSignerPublicKeys
  if (args.externalSignerPublicKeys) {
    if (args.externalSignerPublicKeys.length === 0) {
      throw new YargsError("externalSignerPublicKeys is set to an empty list");
    }

    const externalSignerUrl = args.externalSignerUrl;
    if (!externalSignerUrl) {
      throw new YargsError("Must set externalSignerUrl with externalSignerPublicKeys");
    }

    assertValidPubkeysHex(args.externalSignerPublicKeys);
    assertValidExternalSignerUrl(externalSignerUrl);
    return args.externalSignerPublicKeys.map((pubkeyHex) => ({type: SignerType.Remote, pubkeyHex, externalSignerUrl}));
  }

  if (args.externalSignerFetchPubkeys) {
    const externalSignerUrl = args.externalSignerUrl;
    if (!externalSignerUrl) {
      throw new YargsError("Must set externalSignerUrl with externalSignerFetchPubkeys");
    }

    const fetchedPubkeys = await externalSignerGetKeys(externalSignerUrl);

    assertValidPubkeysHex(fetchedPubkeys);
    return fetchedPubkeys.map((pubkeyHex) => ({type: SignerType.Remote, pubkeyHex, externalSignerUrl}));
  }

  return [];
}

/**
 * Only used for logging remote signers grouped by URL
 */
export function groupExternalSignersByUrl(
  externalSigners: SignerRemote[]
): {externalSignerUrl: string; pubkeysHex: string[]}[] {
  const byUrl = new Map<string, {externalSignerUrl: string; pubkeysHex: string[]}>();

  for (const externalSigner of externalSigners) {
    let x = byUrl.get(externalSigner.externalSignerUrl);
    if (!x) {
      x = {externalSignerUrl: externalSigner.externalSignerUrl, pubkeysHex: []};
      byUrl.set(externalSigner.externalSignerUrl, x);
    }
    x.pubkeysHex.push(externalSigner.pubkeyHex);
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

function assertValidExternalSignerUrl(urlStr: string): void {
  if (!isValidHttpUrl(urlStr)) {
    throw new YargsError(`Invalid external signer URL ${urlStr}`);
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

export function resolveKeystorePaths(fileOrDirPath: string): string[] {
  if (fs.lstatSync(fileOrDirPath).isDirectory()) {
    return fs
      .readdirSync(fileOrDirPath)
      .filter((file) => !depositDataPattern.test(file))
      .map((file) => path.join(fileOrDirPath, file));
  } else {
    return [fileOrDirPath];
  }
}
