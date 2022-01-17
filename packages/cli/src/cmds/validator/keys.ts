import fs from "fs";
import path from "path";
import {Keystore} from "@chainsafe/bls-keystore";
import {SecretKey} from "@chainsafe/bls";
import {deriveEth2ValidatorKeys, deriveKeyFromMnemonic} from "@chainsafe/bls-keygen";
import {interopSecretKey} from "@chainsafe/lodestar-beacon-state-transition";
import {defaultNetwork, IGlobalArgs} from "../../options";
import {parseRange, stripOffNewlines, warnLogger, YargsError} from "../../util";
import {getLockFile} from "../../util/lockfile";
import {ValidatorDirManager} from "../../validatorDir";
import {getAccountPaths} from "../account/paths";
import {IValidatorCliArgs} from "./options";

const LOCK_FILE_EXT = ".lock";
const logger = warnLogger();

export async function getSecretKeys(
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

    const secretKeysPromise = keystorePaths.map(async (keystorePath) => {
      try {
        const keystore = Keystore.parse(fs.readFileSync(keystorePath, "utf8"));
        return SecretKey.fromBytes(await keystore.decrypt(passphrase));
      } catch (e) {
        return Promise.reject(`Failed to parse keystore file: ${keystorePath} with error ${(e as Error).toString()}`);
      }
    });

    const results = await Promise.allSettled(secretKeysPromise);
    const secretKeys: SecretKey[] = [];
    for (const result of results) {
      if (result.status !== "rejected") {
        secretKeys.push(result.value);
      } else {
        logger.warn(result.reason);
      }
    }
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
