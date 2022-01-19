import fs from "fs";
import path from "path";
import {Keystore} from "@chainsafe/bls-keystore";
import {SecretKey} from "@chainsafe/bls";
import {deriveEth2ValidatorKeys, deriveKeyFromMnemonic} from "@chainsafe/bls-keygen";
import {interopSecretKey} from "@chainsafe/lodestar-beacon-state-transition";
import {defaultNetwork, IGlobalArgs} from "../../options";
import {parseRange, stripOffNewlines, YargsError} from "../../util";
import {getLockFile} from "../../util/lockfile";
import {ValidatorDirManager} from "../../validatorDir";
import {getAccountPaths} from "../account/paths";
import {IValidatorCliArgs} from "./options";
import {SecretKeyInfo} from "@chainsafe/lodestar-validator/src/keymanager/impl";

const LOCK_FILE_EXT = ".lock";
const depositDataPattern = new RegExp(/^deposit_data-\d+\.json$/gi);

export async function getSecretKeys(args: IValidatorCliArgs & IGlobalArgs): Promise<{secretKeys: SecretKeyInfo[]}> {
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
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const secretKeys: SecretKeyInfo[] = indexes.map((index) => {
      const {signing} = deriveEth2ValidatorKeys(masterSK, index);
      return {
        secretKey: SecretKey.fromBytes(signing),
      };
    });

    return {secretKeys};
  }

  // Derive interop keys
  else if (args.interopIndexes) {
    const indexes = parseRange(args.interopIndexes);

    const secretKeys: SecretKeyInfo[] = indexes.map((index) => {
      return {
        secretKey: interopSecretKey(index),
      };
    });

    return {secretKeys};
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

    const secretKeys: SecretKeyInfo[] = await Promise.all(
      keystorePaths.map(async (keystorePath) => {
        const secretKey: SecretKey = SecretKey.fromBytes(
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

    return {
      secretKeys,
    };
  }

  // Read keys from local account manager
  else {
    const accountPaths = getAccountPaths(args);
    const validatorDirManager = new ValidatorDirManager(accountPaths);
    const secretKeys = (await validatorDirManager.decryptAllValidators({force: args.force})).map((key) => {
      return {
        secretKey: key,
      };
    });
    return {secretKeys};
  }
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
