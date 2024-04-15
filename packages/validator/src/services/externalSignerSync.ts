import bls from "@chainsafe/bls";
import {CoordType} from "@chainsafe/bls/types";
import {fromHexString} from "@chainsafe/ssz";
import {BeaconConfig} from "@lodestar/config";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {toSafePrintableUrl} from "@lodestar/utils";

import {LoggerVc} from "../util/index.js";
import {externalSignerGetKeys} from "../util/externalSignerClient.js";
import {ValidatorOptions} from "../validator.js";
import {SignerType, ValidatorStore} from "./validatorStore.js";

/**
 * This service is responsible for keeping the keys managed by the connected
 * external signer and the validator client in sync by adding newly discovered keys
 * and removing no longer present keys on external signer from the validator store.
 */
export function pollExternalSignerPubkeys(
  config: BeaconConfig,
  logger: LoggerVc,
  signal: AbortSignal,
  validatorStore: ValidatorStore,
  opts: ValidatorOptions
): void {
  const {externalSigner = {}} = opts;

  if (!externalSigner.url || !externalSigner.fetch) {
    return; // Disabled
  }

  async function syncExternalSignerPubkeys(): Promise<void> {
    // External signer URL is already validated earlier
    const externalSignerUrl = externalSigner.url as string;
    const printableUrl = toSafePrintableUrl(externalSignerUrl);

    try {
      logger.debug("Syncing keys from external signer", {url: printableUrl});
      const externalPubkeys = await externalSignerGetKeys(externalSignerUrl);
      assertValidPubkeysHex(externalPubkeys);
      logger.debug("Retrieved public keys from external signer", {url: printableUrl, count: externalPubkeys.length});

      const localPubkeys = validatorStore.getRemoteSignerPubkeys(externalSignerUrl);
      logger.debug("Local public keys stored for external signer", {url: printableUrl, count: localPubkeys.length});

      // Add newly discovered public keys to remote signers
      const localPubkeysSet = new Set(localPubkeys);
      for (const pubkey of externalPubkeys) {
        if (!localPubkeysSet.has(pubkey)) {
          await validatorStore.addSigner({type: SignerType.Remote, pubkey, url: externalSignerUrl});
          logger.info("Added remote signer", {url: printableUrl, pubkey});
        }
      }

      // Remove remote signers that are no longer present on external signer
      const externalPubkeysSet = new Set(externalPubkeys);
      for (const pubkey of localPubkeys) {
        if (!externalPubkeysSet.has(pubkey)) {
          validatorStore.removeSigner(pubkey);
          logger.info("Removed remote signer", {url: printableUrl, pubkey});
        }
      }
    } catch (e) {
      logger.error("Failed to sync keys from external signer", {url: printableUrl}, e as Error);
    }
  }

  const syncInterval = setInterval(
    syncExternalSignerPubkeys,
    externalSigner?.fetchInterval ??
      // Once per epoch by default
      SLOTS_PER_EPOCH * config.SECONDS_PER_SLOT * 1000
  );
  signal.addEventListener("abort", () => clearInterval(syncInterval), {once: true});
}

function assertValidPubkeysHex(pubkeysHex: string[]): void {
  for (const pubkeyHex of pubkeysHex) {
    const pubkeyBytes = fromHexString(pubkeyHex);
    bls.PublicKey.fromBytes(pubkeyBytes, CoordType.jacobian, true);
  }
}
