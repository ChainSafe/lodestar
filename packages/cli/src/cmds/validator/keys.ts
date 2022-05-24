import fs from "node:fs";
import path from "node:path";
import {Keystore} from "@chainsafe/bls-keystore";
import bls from "@chainsafe/bls";
import {CoordType, SecretKey} from "@chainsafe/bls/types";
import {deriveEth2ValidatorKeys, deriveKeyFromMnemonic} from "@chainsafe/bls-keygen";
import {interopSecretKey} from "@chainsafe/lodestar-beacon-state-transition";
import {externalSignerGetKeys} from "@chainsafe/lodestar-validator";
import {lockFilepath, unlockFilepath} from "@chainsafe/lodestar-keymanager-server";
import {defaultNetwork, IGlobalArgs} from "../../options/index.js";
import {parseRange, stripOffNewlines, YargsError} from "../../util/index.js";
import {ValidatorDirManager} from "../../validatorDir/index.js";
import {getAccountPaths} from "../account/paths.js";
import {IValidatorCliArgs} from "./options.js";
import {fromHexString} from "@chainsafe/ssz";

const depositDataPattern = new RegExp(/^deposit_data-\d+\.json$/gi);

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
        return bls.SecretKey.fromBytes(signing);
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

    // Lock all keystores first
    for (const keystorePath of keystorePaths) {
      lockFilepath(keystorePath);
    }

    const secretKeys = await Promise.all(
      keystorePaths.map(async (keystorePath) => {
        const keystoreStr = fs.readFileSync(keystorePath, "utf8");

        let keystore;
        try {
          keystore = Keystore.parse(keystoreStr);
        } catch (e) {
          (e as Error).message = `Error parsing keystore at ${keystorePath}: ${(e as Error).message}`;
          throw e;
        }

        return bls.SecretKey.fromBytes(await keystore.decrypt(passphrase));
      })
    );

    return {
      secretKeys,
      unlockSecretKeys: () => {
        for (const keystorePath of keystorePaths) {
          // Should not throw if lock file is already deleted
          unlockFilepath(keystorePath);
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
  externalSignerUrl: string;
  pubkeyHex: string;
};

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
    return args.externalSignerPublicKeys.map((pubkeyHex) => ({pubkeyHex, externalSignerUrl}));
  }

  if (args.externalSignerFetchPubkeys) {
    const externalSignerUrl = args.externalSignerUrl;
    if (!externalSignerUrl) {
      throw new YargsError("Must set externalSignerUrl with externalSignerFetchPubkeys");
    }

    const fetchedPubkeys = await externalSignerGetKeys(externalSignerUrl);

    assertValidPubkeysHex(fetchedPubkeys);
    return fetchedPubkeys.map((pubkeyHex) => ({pubkeyHex, externalSignerUrl}));
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
    bls.PublicKey.fromBytes(pubkeyBytes, CoordType.jacobian, true);
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
