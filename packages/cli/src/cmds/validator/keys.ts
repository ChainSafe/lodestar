import fs from "fs";
import path from "path";
import {Keystore} from "@chainsafe/bls-keystore";
import {SecretKey} from "@chainsafe/bls";
import {deriveEth2ValidatorKeys, deriveKeyFromMnemonic} from "@chainsafe/bls-keygen";
import {interopSecretKey} from "@chainsafe/lodestar-beacon-state-transition";
import {defaultNetwork, IGlobalArgs} from "../../options";
import {parseRange, stripOffNewlines, YargsError} from "../../util";
import {ValidatorDirManager} from "../../validatorDir";
import {getAccountPaths} from "../account/paths";
import {IValidatorCliArgs} from "./options";

export async function getSecretKeys(args: IValidatorCliArgs & IGlobalArgs): Promise<SecretKey[]> {
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
      return SecretKey.fromBytes(signing);
    });
  }

  // Derive interop keys
  else if (args.interopIndexes) {
    const indexes = parseRange(args.interopIndexes);
    return indexes.map((index) => interopSecretKey(index));
  }

  // Import JSON keystores and run
  else if (args.importKeystoresPath) {
    if (!args.importKeystoresPassword) {
      throw new YargsError("Must specify importKeystoresPassword with importKeystoresPath");
    }

    const passphrase = stripOffNewlines(fs.readFileSync(args.importKeystoresPassword, "utf8"));

    const keystorePaths = args.importKeystoresPath.map((filepath) => resolveKeystorePaths(filepath)).flat(1);

    return await Promise.all(
      keystorePaths.map(async (keystorePath) =>
        SecretKey.fromBytes(await Keystore.parse(fs.readFileSync(keystorePath, "utf8")).decrypt(passphrase))
      )
    );
  }

  // Read keys from local account manager
  else {
    const accountPaths = getAccountPaths(args);
    const validatorDirManager = new ValidatorDirManager(accountPaths);
    return await validatorDirManager.decryptAllValidators({force: args.force});
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
