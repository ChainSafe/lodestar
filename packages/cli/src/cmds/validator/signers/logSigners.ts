import {Signer, SignerLocal, SignerRemote, SignerType} from "@lodestar/validator";
import {Logger} from "@lodestar/utils";

/**
 * Log each pubkeys for auditing out keys are loaded from the logs
 */
export function logSigners(logger: Pick<Logger, "info">, signers: Signer[]): void {
  const localSigners: SignerLocal[] = [];
  const remoteSigners: SignerRemote[] = [];

  for (const signer of signers) {
    switch (signer.type) {
      case SignerType.Local:
        localSigners.push(signer);
        break;
      case SignerType.Remote:
        remoteSigners.push(signer);
        break;
    }
  }

  if (localSigners.length > 0) {
    logger.info(`${localSigners.length} local keystores`);
    for (const signer of localSigners) {
      logger.info(signer.secretKey.toPublicKey().toHex());
    }
  }

  for (const {url, pubkeys} of groupExternalSignersByUrl(remoteSigners)) {
    logger.info(`External signers on URL: ${url}`);
    for (const pubkey of pubkeys) {
      logger.info(pubkey);
    }
  }
}

/**
 * Only used for logging remote signers grouped by URL
 */
function groupExternalSignersByUrl(externalSigners: SignerRemote[]): {url: string; pubkeys: string[]}[] {
  const byUrl = new Map<string, {url: string; pubkeys: string[]}>();

  for (const externalSigner of externalSigners) {
    let x = byUrl.get(externalSigner.url);
    if (!x) {
      x = {url: externalSigner.url, pubkeys: []};
      byUrl.set(externalSigner.url, x);
    }
    x.pubkeys.push(externalSigner.pubkey);
  }

  return Array.from(byUrl.values());
}
