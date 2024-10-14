import {Signer, SignerLocal, SignerRemote, SignerType} from "@lodestar/validator";
import {LogLevel, Logger, toPrintableUrl} from "@lodestar/utils";
import {YargsError} from "../../../util/errors.js";
import {IValidatorCliArgs} from "../options.js";

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
    logger.info(`Remote signers on URL: ${toPrintableUrl(url)}`);
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

/**
 * Notify user if there are no signers at startup, this might be intended but could also be due to
 * misconfiguration. It is possible that signers are added later via keymanager or if an external signer
 * is connected with fetching enabled, but otherwise exit the process and suggest a different configuration.
 */
export function warnOrExitNoSigners(args: IValidatorCliArgs, logger: Pick<Logger, LogLevel.warn>): void {
  if (args.keymanager && !args["externalSigner.fetch"]) {
    logger.warn("No local keystores or remote keys found with current args, expecting to be added via keymanager");
  } else if (!args.keymanager && args["externalSigner.fetch"]) {
    logger.warn("No remote keys found with current args, expecting to be added to external signer and fetched later");
  } else if (args.keymanager && args["externalSigner.fetch"]) {
    logger.warn(
      "No local keystores or remote keys found with current args, expecting to be added via keymanager or fetched from external signer later"
    );
  } else {
    if (args["externalSigner.url"]) {
      throw new YargsError(
        "No remote keys found with current args, start with --externalSigner.fetch to automatically fetch from external signer"
      );
    }
    throw new YargsError(
      "No local keystores or remote keys found with current args, start with --keymanager if intending to add them later via keymanager"
    );
  }
}
