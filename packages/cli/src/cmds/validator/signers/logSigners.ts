import {Signer, SignerLocal, SignerRemote, SignerType} from "@lodestar/validator";
import {LogLevel, Logger, toSafePrintableUrl} from "@lodestar/utils";

/**
 * Log each pubkeys for auditing out keys are loaded from the logs
 */
export function logSigners(logger: Pick<Logger, LogLevel.info>, signers: Signer[]): void {
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

  for (const {url, pubkeys} of groupRemoteSignersByUrl(remoteSigners)) {
    logger.info(`Remote signers on URL: ${toSafePrintableUrl(url)}`);
    for (const pubkey of pubkeys) {
      logger.info(pubkey);
    }
  }
}

/**
 * Only used for logging remote signers grouped by URL
 */
function groupRemoteSignersByUrl(remoteSigners: SignerRemote[]): {url: string; pubkeys: string[]}[] {
  const byUrl = new Map<string, {url: string; pubkeys: string[]}>();

  for (const remoteSigner of remoteSigners) {
    let x = byUrl.get(remoteSigner.url);
    if (!x) {
      x = {url: remoteSigner.url, pubkeys: []};
      byUrl.set(remoteSigner.url, x);
    }
    x.pubkeys.push(remoteSigner.pubkey);
  }

  return Array.from(byUrl.values());
}
