import {Signer, SignerLocal, SignerRemote, SignerType} from "@chainsafe/lodestar-validator";
import {ILogger} from "@chainsafe/lodestar-utils";

/**
 * Log each pubkeys for auditing out keys are loaded from the logs
 */
export function logSigners(logger: Pick<ILogger, "info">, signers: Signer[]): void {
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

  for (const {externalSignerUrl, pubkeysHex} of groupExternalSignersByUrl(remoteSigners)) {
    logger.info(`External signers on URL: ${externalSignerUrl}`);
    for (const pubkeyHex of pubkeysHex) {
      logger.info(pubkeyHex);
    }
  }
}

/**
 * Only used for logging remote signers grouped by URL
 */
function groupExternalSignersByUrl(
  externalSigners: SignerRemote[]
): {externalSignerUrl: string; pubkeysHex: string[]}[] {
  const byUrl = new Map<string, {externalSignerUrl: string; pubkeysHex: string[]}>();

  for (const externalSigner of externalSigners) {
    let x = byUrl.get(externalSigner.externalSignerUrl);
    if (!x) {
      x = {externalSignerUrl: externalSigner.externalSignerUrl, pubkeysHex: []};
      byUrl.set(externalSigner.externalSignerUrl, x);
    }
    x.pubkeysHex.push(externalSigner.pubkeyHex);
  }

  return Array.from(byUrl.values());
}
