import path from "node:path";
import {deriveEth2ValidatorKeys, deriveKeyFromMnemonic} from "@chainsafe/bls-keygen";
import {SecretKey} from "@chainsafe/blst";
import {interopSecretKey} from "@lodestar/state-transition";
import {externalSignerGetKeys, Signer, SignerType} from "@lodestar/validator";
import {LogLevel, Logger, isValidHttpUrl} from "@lodestar/utils";
import {defaultNetwork, GlobalArgs} from "../../../options/index.js";
import {assertValidPubkeysHex, parseRange, YargsError} from "../../../util/index.js";
import {getAccountPaths} from "../paths.js";
import {IValidatorCliArgs} from "../options.js";
import {PersistedKeysBackend} from "../keymanager/persistedKeys.js";
import {decryptKeystoreDefinitions} from "../keymanager/decryptKeystoreDefinitions.js";
import {showProgress} from "../../../util/progress.js";
import {importKeystoreDefinitionsFromExternalDir, readPassphraseOrPrompt} from "./importExternalKeystores.js";

const KEYSTORE_IMPORT_PROGRESS_MS = 10000;

/**
 * Options processing hierarchy
 * --interopIndexes
 * --fromMnemonic, then requires --mnemonicIndexes
 * --importKeystores, then requires --importKeystoresPassword
 * --externalSigner.fetch, then requires --externalSigner.url
 * --externalSigner.pubkeys, then requires --externalSigner.url
 * else load from persisted
 * - both remote keys and local keystores
 *
 * @returns Signers =  an item capable of producing signatures. Two types exist:
 * - Local: a secret key capable of signing
 * - Remote: a URL that supports EIP-3030 (BLS Remote Signer HTTP API)
 *
 *  Local secret keys can be gathered from:
 * - Local keystores existent on disk
 * - Local keystores imported via keymanager api
 * - Derived from a mnemonic (TESTING ONLY)
 * - Derived from interop keys (TESTING ONLY)
 *
 * Remote signers need to pre-declare the list of pubkeys to validate with
 * - Via CLI argument
 * - Fetched directly from remote signer API
 * - Remote signer definition imported from keymanager api
 */
export async function getSignersFromArgs(
  args: IValidatorCliArgs & GlobalArgs,
  network: string,
  {logger, signal}: {logger: Pick<Logger, LogLevel.info | LogLevel.warn | LogLevel.debug>; signal: AbortSignal}
): Promise<Signer[]> {
  const accountPaths = getAccountPaths(args, network);

  // ONLY USE FOR TESTNETS - Derive interop keys
  if (args.interopIndexes) {
    const indexes = parseRange(args.interopIndexes);
    // Using a remote signer with TESTNETS
    if (args["externalSigner.pubkeys"] || args["externalSigner.fetch"]) {
      return getRemoteSigners(args);
    }
    return indexes.map((index) => ({type: SignerType.Local, secretKey: interopSecretKey(index)}));
  }

  // UNSAFE, ONLY USE FOR TESTNETS - Derive keys directly from a mnemonic
  if (args.fromMnemonic) {
    if (network === defaultNetwork) {
      throw new YargsError("fromMnemonic must only be used in testnets");
    }
    if (!args.mnemonicIndexes) {
      throw new YargsError("Must specify mnemonicIndexes with fromMnemonic");
    }

    const masterSK = deriveKeyFromMnemonic(args.fromMnemonic);
    const indexes = parseRange(args.mnemonicIndexes);
    return indexes.map((index) => ({
      type: SignerType.Local,
      secretKey: SecretKey.fromBytes(deriveEth2ValidatorKeys(masterSK, index).signing),
    }));
  }

  // Import JSON keystores and run
  if (args.importKeystores) {
    const keystoreDefinitions = importKeystoreDefinitionsFromExternalDir({
      keystoresPath: args.importKeystores,
      password: await readPassphraseOrPrompt(args),
    });

    const needle = showProgress({
      total: keystoreDefinitions.length,
      frequencyMs: KEYSTORE_IMPORT_PROGRESS_MS,
      signal,
      progress: ({ratePerSec, percentage, current, total}) => {
        logger.info(
          `${percentage.toFixed(0)}% of keystores imported. current=${current} total=${total} rate=${(
            ratePerSec * 60
          ).toFixed(2)}keys/m`
        );
      },
    });
    return decryptKeystoreDefinitions(keystoreDefinitions, {
      ignoreLockFile: args.force,
      onDecrypt: needle,
      cacheFilePath: path.join(accountPaths.cacheDir, "imported_keystores.cache"),
      disableThreadPool: args["disableKeystoresThreadPool"],
      logger,
      signal,
    });
  }

  // Remote keys are declared manually or will be fetched from external signer
  if (args["externalSigner.pubkeys"] || args["externalSigner.fetch"]) {
    return getRemoteSigners(args);
  }

  // Read keys from local account manager
  const persistedKeysBackend = new PersistedKeysBackend(accountPaths);

  // Read and decrypt local keystores, imported via keymanager api or import cmd
  const keystoreDefinitions = persistedKeysBackend.readAllKeystores();

  const needle = showProgress({
    total: keystoreDefinitions.length,
    frequencyMs: KEYSTORE_IMPORT_PROGRESS_MS,
    signal,
    progress: ({ratePerSec, percentage, current, total}) => {
      logger.info(
        `${percentage.toFixed(0)}% of local keystores imported. current=${current} total=${total} rate=${(
          ratePerSec * 60
        ).toFixed(2)}keys/m`
      );
    },
  });

  const keystoreSigners = await decryptKeystoreDefinitions(keystoreDefinitions, {
    ignoreLockFile: args.force,
    onDecrypt: needle,
    cacheFilePath: path.join(accountPaths.cacheDir, "local_keystores.cache"),
    disableThreadPool: args["disableKeystoresThreadPool"],
    logger,
    signal,
  });

  // Read local remote keys, imported via keymanager api
  const signerDefinitions = persistedKeysBackend.readAllRemoteKeys();
  const remoteSigners = signerDefinitions.map(({url, pubkey}): Signer => ({type: SignerType.Remote, url, pubkey}));

  return [...keystoreSigners, ...remoteSigners];
}

export function getSignerPubkeyHex(signer: Signer): string {
  switch (signer.type) {
    case SignerType.Local:
      return signer.secretKey.toPublicKey().toHex();

    case SignerType.Remote:
      return signer.pubkey;
  }
}

async function getRemoteSigners(args: IValidatorCliArgs & GlobalArgs): Promise<Signer[]> {
  const externalSignerUrl = args["externalSigner.url"];
  if (!externalSignerUrl) {
    throw new YargsError(
      `Must set externalSigner.url with ${
        args["externalSigner.pubkeys"] ? "externalSigner.pubkeys" : "externalSigner.fetch"
      }`
    );
  }
  if (!isValidHttpUrl(externalSignerUrl)) {
    throw new YargsError(`Invalid external signer URL: ${externalSignerUrl}`);
  }
  if (args["externalSigner.pubkeys"] && args["externalSigner.pubkeys"].length === 0) {
    throw new YargsError("externalSigner.pubkeys is set to an empty list");
  }

  const pubkeys = args["externalSigner.pubkeys"] ?? (await externalSignerGetKeys(externalSignerUrl));
  assertValidPubkeysHex(pubkeys);

  return pubkeys.map((pubkey) => ({type: SignerType.Remote, pubkey, url: externalSignerUrl}));
}
