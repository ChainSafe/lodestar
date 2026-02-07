import path from "node:path";
import {deriveEth2ValidatorKeys, deriveKeyFromMnemonic} from "@chainsafe/bls-keygen";
import {SecretKey} from "@chainsafe/blst";
import {interopSecretKey} from "@lodestar/state-transition";
import {LogLevel, Logger, isValidHttpUrl} from "@lodestar/utils";
import {Signer, SignerType, externalSignerGetKeys} from "@lodestar/validator";
import {GlobalArgs, defaultNetwork} from "../../../options/index.js";
import {YargsError, assertValidPubkeysHex} from "../../../util/index.js";
import {showProgress} from "../../../util/progress.js";
import {decryptKeystoreDefinitions} from "../keymanager/decryptKeystoreDefinitions.js";
import {PersistedKeysBackend} from "../keymanager/persistedKeys.js";
import {IValidatorCliArgs} from "../options.js";
import {getAccountPaths} from "../paths.js";
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
    const indexes = args.interopIndexes;
    // Using a remote signer with TESTNETS
    if (args["externalSigner.pubkeys"] || args["externalSigner.fetch"]) {
      return getRemoteSigners(args, {logger});
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
    const indexes = Array.from(new Set(args.mnemonicIndexes));
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
      disableThreadPool: args.disableKeystoresThreadPool,
      logger,
      signal,
    });
  }

  // Remote keys are declared manually or will be fetched from external signer
  if (args["externalSigner.pubkeys"] || args["externalSigner.fetch"]) {
    return getRemoteSigners(args, {logger});
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
    disableThreadPool: args.disableKeystoresThreadPool,
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

async function getRemoteSigners(
  args: IValidatorCliArgs & GlobalArgs,
  context: {logger: Pick<Logger, LogLevel.warn>}
): Promise<Signer[]> {
  const {logger} = context;
  const externalSignerUrls = args["externalSigner.url"] ?? [];

  if (externalSignerUrls.length === 0) {
    throw new YargsError(
      `Must set externalSigner.url with ${
        args["externalSigner.pubkeys"] ? "externalSigner.pubkeys" : "externalSigner.fetch"
      }`
    );
  }

  // Validate all URLs
  for (const url of externalSignerUrls) {
    if (!isValidHttpUrl(url)) {
      throw new YargsError(`Invalid external signer URL: ${url}`);
    }
  }

  if (args["externalSigner.pubkeys"] && args["externalSigner.pubkeys"].length === 0) {
    throw new YargsError("externalSigner.pubkeys is set to an empty list");
  }

  const signers: Signer[] = [];

  if (args["externalSigner.pubkeys"]) {
    // If pubkeys are explicitly provided with multiple URLs, warn user about limitation
    if (externalSignerUrls.length > 1) {
      throw new YargsError(
        "Cannot use --externalSigner.pubkeys with multiple --externalSigner.url values. " +
          "When explicitly providing pubkeys, all pubkeys are associated with the first URL. " +
          "To use multiple signers, use --externalSigner.fetch instead to fetch pubkeys from each signer."
      );
    }
    // If pubkeys are explicitly provided, assign them to the first (and only) URL
    // This maintains backward compatibility
    const pubkeys = args["externalSigner.pubkeys"];
    assertValidPubkeysHex(pubkeys);
    for (const pubkey of pubkeys) {
      signers.push({type: SignerType.Remote, pubkey, url: externalSignerUrls[0]});
    }
  } else {
    // Fetch pubkeys from all external signer URLs
    // Handle errors per signer to allow validator to start even if some signers are unavailable
    const pubkeyPromises = externalSignerUrls.map(async (url) => {
      try {
        const pubkeys = await externalSignerGetKeys(url);
        return {url, pubkeys, error: null};
      } catch (e) {
        const errorMsg = e instanceof Error ? e.message : String(e);
        logger.warn(`Failed to fetch pubkeys from external signer ${url}: ${errorMsg}`);
        return {url, pubkeys: [], error: errorMsg};
      }
    });

    const results = await Promise.all(pubkeyPromises);

    // Check if all signers failed
    const failedSigners = results.filter((r) => r.error !== null);
    const successfulSigners = results.filter((r) => r.pubkeys.length > 0);

    if (failedSigners.length === results.length) {
      // All signers failed - throw error to prevent silent failure
      const errorMessages = failedSigners.map((r) => `  ${r.url}: ${r.error}`).join("\n");
      throw new YargsError(
        `Failed to fetch pubkeys from all external signer(s):\n${errorMessages}\n` +
          "Please verify the signer URLs are correct and accessible."
      );
    }

    // Warn if some signers failed but at least one succeeded
    if (failedSigners.length > 0 && successfulSigners.length > 0) {
      const failedUrls = failedSigners.map((r) => r.url).join(", ");
      logger.warn(
        `Failed to fetch pubkeys from some external signer(s): ${failedUrls}. ` +
          "Validator will continue with available signers."
      );
    }

    const seenPubkeys = new Set<string>();
    for (const {url, pubkeys} of results) {
      if (pubkeys.length > 0) {
        assertValidPubkeysHex(pubkeys);
        for (const pubkey of pubkeys) {
          if (seenPubkeys.has(pubkey)) {
            logger.warn(`Pubkey ${pubkey} found on multiple signers; using first occurrence only`);
            continue;
          }
          seenPubkeys.add(pubkey);
          signers.push({type: SignerType.Remote, pubkey, url});
        }
      }
    }
  }

  return signers;
}
