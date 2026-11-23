import fs from "node:fs";
import path from "node:path";
import {deriveEth2ValidatorKeys, deriveKeyFromMnemonic} from "@chainsafe/bls-keygen";
import {SecretKey} from "@lodestar/native/blst";
import {interopSecretKey} from "@lodestar/state-transition";
import {LogLevel, Logger, fetch, isValidHttpUrl, retry, toPubkeyHex} from "@lodestar/utils";
import {
  Signer,
  SignerType,
  XmssSigner,
  XmssTreeStore,
  externalSignerGetKeys,
  interopXmssSigner,
} from "@lodestar/validator";
import {getBeaconConfigFromArgs} from "../../../config/index.js";
import {GlobalArgs, defaultNetwork} from "../../../options/index.js";
import {YargsError, assertValidPubkeysHex} from "../../../util/index.js";
import {showProgress} from "../../../util/progress.js";
import {decryptKeystoreDefinitions} from "../keymanager/decryptKeystoreDefinitions.js";
import {PersistedKeysBackend} from "../keymanager/persistedKeys.js";
import {IValidatorCliArgs} from "../options.js";
import {getAccountPaths} from "../paths.js";
import {importKeystoreDefinitionsFromExternalDir, readPassphraseOrPrompt} from "./importExternalKeystores.js";
import {devnetXmssTreeSource} from "./xmssCache.js";

const KEYSTORE_IMPORT_PROGRESS_MS = 10000;

/**
 * Options processing hierarchy
 * --interopIndexes
 * --fromMnemonic, then requires --mnemonicIndexes
 * --importKeystores, then requires --importKeystoresPassword
 * --externalSigner.fetch, then requires --externalSigner.urls
 * --externalSigner.pubkeys, then requires --externalSigner.urls
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
      return getRemoteSigners(args, logger);
    }
    // A network that starts at the pq fork has leanXMSS validators
    if (getBeaconConfigFromArgs(args).config.PQ_FORK_EPOCH === 0) {
      logger.info("Generating interop leanXMSS keys and VRF trees", {count: indexes.length});
      return Promise.all(
        indexes.map(async (index): Promise<Signer> => ({type: SignerType.Xmss, signer: await interopXmssSigner(index)}))
      );
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
    return getRemoteSigners(args, logger);
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

/**
 * On a network that starts at the pq fork, a validator's BLS keystore stands for its leanXMSS key
 * and its VRF tree, both derived from the keystore's secret key.
 */
export async function toXmssSigners(
  signers: Signer[],
  vrfStateUrl: string | undefined,
  xmssCacheUrl: string | undefined,
  treesDir: string,
  logger: Pick<Logger, LogLevel.info | LogLevel.warn | LogLevel.error>
): Promise<Signer[]> {
  const localCount = signers.filter((signer) => signer.type === SignerType.Local).length;
  if (localCount === 0) return signers;

  let vrfStates: Uint8Array | undefined;
  if (vrfStateUrl) {
    if (isValidHttpUrl(vrfStateUrl)) {
      vrfStates = await retry(
        async () => {
          const res = await fetch(vrfStateUrl);
          if (!res.ok) throw Error(`Fetching ${vrfStateUrl} failed with status ${res.status}`);
          return new Uint8Array(await res.arrayBuffer());
        },
        {retries: 5, retryDelay: 2000}
      );
    } else {
      vrfStates = fs.readFileSync(vrfStateUrl.replace(/^file:\/\//, ""));
    }
  } else {
    logger.warn("No vrfStateUrl: VRF trees hold their first 2^20 slots and zeros after, not full trees");
  }

  fs.mkdirSync(treesDir, {recursive: true});
  const treeStores = new Map<Signer, XmssTreeStore>();
  const uncached: Uint8Array[] = [];
  for (const signer of signers) {
    if (signer.type !== SignerType.Local) continue;
    const treeStore = xmssTreeStore(path.join(treesDir, `${signer.secretKey.toPublicKey().toHex()}.bin`));
    treeStores.set(signer, treeStore);
    const secretKey = signer.secretKey.toBytes();
    if (xmssCacheUrl && !XmssSigner.hasStoredTrees(secretKey, treeStore)) {
      uncached.push(XmssSigner.publicParameterFromBlsSecretKey(secretKey));
    }
  }
  const treeSource = xmssCacheUrl ? await devnetXmssTreeSource(xmssCacheUrl, uncached, logger) : undefined;

  logger.info("Deriving leanXMSS keys and VRF trees from keystores", {count: localCount});
  return Promise.all(
    signers.map(async (signer): Promise<Signer> => {
      if (signer.type !== SignerType.Local) return signer;
      const secretKey = signer.secretKey.toBytes();
      const treeStore = treeStores.get(signer);
      try {
        return {
          type: SignerType.Xmss,
          signer: await XmssSigner.fromBlsSecretKey(secretKey, {vrfStates, treeStore, treeSource}),
        };
      } catch (e) {
        if (!(e as Error).message.includes("NoMatchingState")) throw e;
        // It still attests: only its proposals need the tree
        const xmssSigner = await XmssSigner.fromBlsSecretKey(secretKey, {treeStore, treeSource});
        logger.error("No VRF state for validator: it cannot propose", {pubkey: toPubkeyHex(xmssSigner.publicKey)});
        return {type: SignerType.Xmss, signer: xmssSigner};
      }
    })
  );
}

function xmssTreeStore(filepath: string): XmssTreeStore {
  return {
    read: () => {
      try {
        return fs.readFileSync(filepath);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw e;
      }
    },
    // Renamed into place, so that a stop mid-write leaves the file it had
    write: (bytes) => {
      fs.writeFileSync(`${filepath}.tmp`, bytes);
      fs.renameSync(`${filepath}.tmp`, filepath);
    },
  };
}

export function getSignerPubkeyHex(signer: Signer): string {
  switch (signer.type) {
    case SignerType.Local:
      return signer.secretKey.toPublicKey().toHex();

    case SignerType.Remote:
      return signer.pubkey;

    case SignerType.Xmss:
      return toPubkeyHex(signer.signer.publicKey);
  }
}

async function getRemoteSigners(
  args: IValidatorCliArgs & GlobalArgs,
  logger: Pick<Logger, LogLevel.info | LogLevel.warn | LogLevel.debug>
): Promise<Signer[]> {
  const externalSignerUrls = args["externalSigner.urls"] ?? [];

  if (externalSignerUrls.length === 0) {
    throw new YargsError(
      `Must set externalSigner.urls with ${
        args["externalSigner.pubkeys"] ? "externalSigner.pubkeys" : "externalSigner.fetch"
      }`
    );
  }

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
        "Cannot use --externalSigner.pubkeys with multiple --externalSigner.urls. " +
          "When using --externalSigner.pubkeys, only a single URL is allowed. " +
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
    // Fetch pubkeys from all external signer URLs, fail startup if any signer is unavailable
    const results: {url: string; pubkeys: string[]}[] = [];
    const failures: {url: string; error: string}[] = [];
    await Promise.all(
      externalSignerUrls.map(async (url) => {
        try {
          const pubkeys = await externalSignerGetKeys(url);
          results.push({url, pubkeys});
        } catch (e) {
          const errorMsg = e instanceof Error ? e.message : String(e);
          failures.push({url, error: errorMsg});
        }
      })
    );
    if (failures.length > 0) {
      const errorMessages = failures.map((f) => `  ${f.url}: ${f.error}`).join("\n");
      throw new YargsError(
        `Failed to fetch pubkeys from external signer(s):\n${errorMessages}\n` +
          "Please verify the signer URLs are correct and reachable."
      );
    }

    const seenPubkeys = new Map<string, string>();
    for (const {url, pubkeys} of results) {
      if (pubkeys.length > 0) {
        assertValidPubkeysHex(pubkeys);
        for (const pubkey of pubkeys) {
          const firstUrl = seenPubkeys.get(pubkey);
          if (firstUrl !== undefined) {
            logger.warn("Duplicate pubkey found on multiple signers, using first occurrence only", {
              pubkey,
              firstUrl,
              duplicateUrl: url,
            });
            continue;
          }
          seenPubkeys.set(pubkey, url);
          signers.push({type: SignerType.Remote, pubkey, url});
        }
      }
    }
  }

  return signers;
}
