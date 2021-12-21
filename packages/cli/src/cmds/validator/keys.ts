import fs from "fs";
import path from "path";
import {Keystore} from "@chainsafe/bls-keystore";
import {PublicKey, SecretKey} from "@chainsafe/bls";
import {deriveEth2ValidatorKeys, deriveKeyFromMnemonic} from "@chainsafe/bls-keygen";
import {interopSecretKey} from "@chainsafe/lodestar-beacon-state-transition";
import {Signers, SignerType, requestKeys} from "@chainsafe/lodestar-validator";
import {defaultNetwork, IGlobalArgs} from "../../options";
import {parseRange, stripOffNewlines, YargsError} from "../../util";
import {getLockFile} from "../../util/lockfile";
import {ValidatorDirManager} from "../../validatorDir";
import {getAccountPaths} from "../account/paths";
import {IValidatorCliArgs} from "./options";

const LOCK_FILE_EXT = ".lock";

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

export async function getPublicKeys(args: IValidatorCliArgs & IGlobalArgs): Promise<PublicKey[]> {
  const pubkeys: PublicKey[] = [];
  let publicKeys: string[] = [];

  if (!args.publicKeys) {
    throw new YargsError("No public keys found.");
  }

  if (isValidHttpUrl(args.publicKeys)) {
    // TODO: Make a reuqest to return publicKeys
    publicKeys = await requestKeys(args.signingUrl);
  } else {
    publicKeys = args.publicKeys?.split(",");
  }

  for (const pubkeyHex of publicKeys) {
    pubkeys.push(PublicKey.fromHex(pubkeyHex));
  }
  return pubkeys;
}

export function isValidHttpUrl(input: string): boolean {
  let url;
  try {
    url = new URL(input);
  } catch (_) {
    return false;
  }

  return url.protocol === "http:" || url.protocol === "https:";
}

export function getPublicKeysFromSecretKeys(secretKeys: SecretKey[]): PublicKey[] {
  const pubkeys: PublicKey[] = [];
  for (let i = 0; i < secretKeys.length; i++) {
    pubkeys.push(secretKeys[i].toPublicKey());
  }
  return pubkeys;
}

export function getSignersObject(
  signingMode: string,
  signingUrl: string | undefined,
  secretKeys: SecretKey[],
  pubkeys: PublicKey[]
): Signers {
  let signers: Signers;
  /** True is for remote mode, False is local mode */
  if (signingMode.toLowerCase() === "remote") {
    /** If remote mode chosen but no url provided */
    if (!signingUrl) {
      throw new YargsError("Remote mode requires --signingUrl argument");
    }
    signers = {
      type: SignerType.Remote,
      url: signingUrl,
      pubkeys: pubkeys,
      secretKey: new SecretKey(),
    };
  } else if (signingMode.toLowerCase() === "local") {
    signers = {
      type: SignerType.Local,
      secretKeys: secretKeys,
    };
  } else {
    throw new YargsError("Invalid mode. Only local and remote are supported");
  }
  return signers;
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
