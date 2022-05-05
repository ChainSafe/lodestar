import bls from "@chainsafe/bls";
import {deriveEth2ValidatorKeys, deriveKeyFromMnemonic} from "@chainsafe/bls-keygen";
import {interopSecretKey} from "@chainsafe/lodestar-beacon-state-transition";
import {externalSignerGetKeys, Signer, SignerType} from "@chainsafe/lodestar-validator";
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
  else if (args.externalSignerPublicKeys) {
    if (args.externalSignerPublicKeys.length === 0) {
      throw new YargsError("externalSignerPublicKeys is set to an empty list");
    }
    if (args.externalSignerFetchPubkeys) {
      throw new YargsError("Flag externalSignerFetchPubkeys is ignored if externalSignerPublicKeys is set");
    }

    const {externalSignerUrl} = args;
    if (!externalSignerUrl) {
      throw new YargsError("Must set externalSignerUrl with externalSignerPublicKeys");
    }
    if (!isValidHttpUrl(externalSignerUrl)) {
      throw new YargsError(`Invalid external signer URL ${externalSignerUrl}`);
    }

    assertValidPubkeysHex(args.externalSignerPublicKeys);

    return args.externalSignerPublicKeys.map((pubkeyHex) => ({type: SignerType.Remote, pubkeyHex, externalSignerUrl}));
  }

  // Fetch all keys available in remote signer
  else if (args.externalSignerFetchPubkeys) {
    const {externalSignerUrl} = args;
    if (!externalSignerUrl) {
      throw new YargsError("Must set externalSignerUrl with externalSignerFetchPubkeys");
    }

    const fetchedPubkeys = await externalSignerGetKeys(externalSignerUrl);
    assertValidPubkeysHex(fetchedPubkeys);
    return fetchedPubkeys.map((pubkeyHex) => ({type: SignerType.Remote, pubkeyHex, externalSignerUrl}));
  }

  // Read keys from local account manager
  else {
    const accountPaths = getAccountPaths(args);
    const persistedKeysBackend = new PersistedKeysBackend(accountPaths);
    const keystoreDefinitions = persistedKeysBackend.readAllKeystores();
    const remoteKeySigners = persistedKeysBackend.readAllRemoteKeys();
    const keystoreSigners = await decryptKeystoreDefinitions(keystoreDefinitions, args);
    const remoteSigners = remoteKeySigners.map(
      (remoteSigner): Signer => ({
        type: SignerType.Remote,
        pubkeyHex: remoteSigner.pubkey,
        externalSignerUrl: remoteSigner.url,
      })
    );
    return [...keystoreSigners, ...remoteSigners];
  }
}

export type SignerRemote = {
  externalSignerUrl: string;
  pubkeyHex: string;
};

export function getSignerPubkeyHex(signer: Signer): string {
  switch (signer.type) {
    case SignerType.Local:
      return toHexString(signer.secretKey.toPublicKey().toBytes());

    case SignerType.Remote:
      return signer.pubkeyHex;
  }
}
