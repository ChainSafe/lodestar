import bls from "@chainsafe/bls";
import {deriveEth2ValidatorKeys, deriveKeyFromMnemonic} from "@chainsafe/bls-keygen";
import {interopSecretKey} from "@lodestar/state-transition";
import {externalSignerGetKeys, Signer, SignerType} from "@lodestar/validator";
import {toHexString} from "@chainsafe/ssz";
import {defaultNetwork, IGlobalArgs} from "../../../options/index.js";
import {assertValidPubkeysHex, isValidHttpUrl, parseRange, YargsError} from "../../../util/index.js";
import {getAccountPaths} from "../paths.js";
import {IValidatorCliArgs} from "../options.js";
import {decryptKeystoreDefinitions, PersistedKeysBackend} from "../keymanager/persistedKeys.js";
import {importKeystoreDefinitionsFromExternalDir, readPassphraseOrPrompt} from "./importExternalKeystores.js";

/**
 * Options processing heriarchy
 * --interopIndexes
 * --fromMnemonic, then requires --mnemonicIndexes
 * --importKeystoresPath, then requires --importKeystoresPassword
 * --externalSignerFetchPubkeys, then requires --externalSignerUrl
 * --externalSignerPublicKeys, then requires --externalSignerUrl
 * else load from persisted
 * - both remote keys and local keystores
 *
 * @returns Signers =  an item capable of producing signatures. Two types exist:
 * - Local: a secret key capable of signing
 * - Remote: a URL that supports EIP-3030 (BLS Remote Signer HTTP API)
 *
 *  Local secret keys can be gathered from:
 * - Local keystores existant on disk
 * - Local keystores imported via keymanager api
 * - Derived from a mnemonic (TESTING ONLY)
 * - Derived from interop keys (TESTING ONLY)
 *
 * Remote signers need to pre-declare the list of pubkeys to validate with
 * - Via CLI argument
 * - Fetched directly from remote signer API
 * - Remote signer definition imported from keymanager api
 */
export async function getSignersFromArgs(args: IValidatorCliArgs & IGlobalArgs): Promise<Signer[]> {
  // ONLY USE FOR TESTNETS - Derive interop keys
  if (args.interopIndexes) {
    const indexes = parseRange(args.interopIndexes);
    return indexes.map((index) => ({type: SignerType.Local, secretKey: interopSecretKey(index)}));
  }

  // UNSAFE, ONLY USE FOR TESTNETS - Derive keys directly from a mnemonic
  else if (args.fromMnemonic) {
    if (args.network === defaultNetwork) {
      throw new YargsError("fromMnemonic must only be used in testnets");
    }
    if (!args.mnemonicIndexes) {
      throw new YargsError("Must specify mnemonicIndexes with fromMnemonic");
    }

    const masterSK = deriveKeyFromMnemonic(args.fromMnemonic);
    const indexes = parseRange(args.mnemonicIndexes);
    return indexes.map((index) => ({
      type: SignerType.Local,
      secretKey: bls.SecretKey.fromBytes(deriveEth2ValidatorKeys(masterSK, index).signing),
    }));
  }

  // Import JSON keystores and run
  else if (args.importKeystoresPath) {
    const keystoreDefinitions = importKeystoreDefinitionsFromExternalDir({
      keystoresPath: args.importKeystoresPath,
      password: await readPassphraseOrPrompt(args),
    });

    return await decryptKeystoreDefinitions(keystoreDefinitions, args);
  }

  // Remote keys declared manually with --externalSignerPublicKeys
  else if (args["externalSigner.pubkeys"] || args["externalSigner.fetch"]) {
    const externalSignerUrl = args["externalSigner.url"];
    if (!externalSignerUrl) {
      throw new YargsError("Must set externalSignerUrl with externalSignerPublicKeys");
    }
    if (!isValidHttpUrl(externalSignerUrl)) {
      throw new YargsError(`Invalid external signer URL ${externalSignerUrl}`);
    }
    if (args["externalSigner.pubkeys"] && args["externalSigner.pubkeys"].length === 0) {
      throw new YargsError("externalSignerPublicKeys is set to an empty list");
    }

    const pubkeys = args["externalSigner.pubkeys"] ?? (await externalSignerGetKeys(externalSignerUrl));
    assertValidPubkeysHex(pubkeys);

    return pubkeys.map((pubkey) => ({type: SignerType.Remote, pubkey, url: externalSignerUrl}));
  }

  // Read keys from local account manager
  else {
    const accountPaths = getAccountPaths(args);
    const persistedKeysBackend = new PersistedKeysBackend(accountPaths);

    // Read and decrypt local keystores, imported via keymanager api or import cmd
    const keystoreDefinitions = persistedKeysBackend.readAllKeystores();
    const keystoreSigners = await decryptKeystoreDefinitions(keystoreDefinitions, args);

    // Read local remote keys, imported via keymanager api
    const signerDefinitions = persistedKeysBackend.readAllRemoteKeys();
    const remoteSigners = signerDefinitions.map(({url, pubkey}): Signer => ({type: SignerType.Remote, url, pubkey}));

    return [...keystoreSigners, ...remoteSigners];
  }
}

export function getSignerPubkeyHex(signer: Signer): string {
  switch (signer.type) {
    case SignerType.Local:
      return toHexString(signer.secretKey.toPublicKey().toBytes());

    case SignerType.Remote:
      return signer.pubkey;
  }
}
