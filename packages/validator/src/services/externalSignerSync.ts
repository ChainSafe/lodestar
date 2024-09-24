import {PublicKey} from "@chainsafe/blst";
import {ChainForkConfig} from "@lodestar/config";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {fromHex, toPrintableUrl} from "@lodestar/utils";

import {LoggerVc} from "../util/index.js";
import {externalSignerGetKeys} from "../util/externalSignerClient.js";
import {SignerType, ValidatorStore} from "./validatorStore.js";

export type ExternalSignerOptions = {
  url?: string;
  fetch?: boolean;
  fetchInterval?: number;
};

/**
 * This service is responsible for keeping the keys managed by the connected
 * external signer and the validator client in sync by adding newly discovered keys
 * and removing no longer present keys on external signer from the validator store.
 */
export function pollExternalSignerPubkeys(
  config: ChainForkConfig,
  logger: LoggerVc,
  signal: AbortSignal,
  validatorStore: ValidatorStore,
  opts?: ExternalSignerOptions
): void {
  const externalSigner = opts ?? {};

  if (!externalSigner.url || !externalSigner.fetch) {
    return; // Disabled
  }

  async function fetchExternalSignerPubkeys(): Promise<void> {
    // External signer URL is already validated earlier
    const externalSignerUrl = externalSigner.url as string;
    const printableUrl = toPrintableUrl(externalSignerUrl);

    try {
      logger.debug("Fetching public keys from external signer", {url: printableUrl});
      const externalPubkeys = await externalSignerGetKeys(externalSignerUrl);
      assertValidPubkeysHex(externalPubkeys);
      logger.debug("Received public keys from external signer", {url: printableUrl, count: externalPubkeys.length});

      const localPubkeys = validatorStore.getRemoteSignerPubkeys(externalSignerUrl);
      logger.debug("Local public keys stored for external signer", {url: printableUrl, count: localPubkeys.length});

      const localPubkeysSet = new Set(localPubkeys);
      for (const pubkey of externalPubkeys) {
        if (!localPubkeysSet.has(pubkey)) {
          await validatorStore.addSigner({type: SignerType.Remote, pubkey, url: externalSignerUrl});
          logger.info("Added remote signer", {pubkey, url: printableUrl});
        }
      }

      const externalPubkeysSet = new Set(externalPubkeys);
      for (const pubkey of localPubkeys) {
        if (!externalPubkeysSet.has(pubkey)) {
          validatorStore.removeSigner(pubkey);
          logger.info("Removed remote signer", {pubkey, url: printableUrl});
        }
      }
    } catch (e) {
      logger.error("Failed to fetch public keys from external signer", {url: printableUrl}, e as Error);
    }
  }

  const interval = setInterval(
    fetchExternalSignerPubkeys,
    externalSigner.fetchInterval ??
      // Once per epoch by default
      SLOTS_PER_EPOCH * config.SECONDS_PER_SLOT * 1000
  );
  signal.addEventListener("abort", () => clearInterval(interval), {once: true});
}

function assertValidPubkeysHex(pubkeysHex: string[]): void {
  for (const pubkeyHex of pubkeysHex) {
    const pubkeyBytes = fromHex(pubkeyHex);
    PublicKey.fromBytes(pubkeyBytes, true);
  }
}
