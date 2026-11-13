import {ChainForkConfig} from "@lodestar/config";
import {type PubkeyCache} from "@lodestar/native/pubkeys";
import {getValidatorsBytesFromStateBytes} from "@lodestar/state-transition";
import {Logger} from "@lodestar/utils";

/**
 * Best effort load of a trusted pubkey cache saved by a previous run, to skip decompressing every validator
 * pubkey on boot. Must be called before any worker uses the cache.
 */
export function loadPubkeysFile(
  pubkeyCache: PubkeyCache,
  filepath: string,
  maxCapacity: number,
  config: ChainForkConfig,
  anchorStateBytes: Uint8Array,
  anchorValidatorCount: number,
  logger: Logger
): void {
  const start = Date.now();
  try {
    pubkeyCache.load(filepath, maxCapacity);
  } catch (e) {
    logger.debug("Unable to load pubkeys file", {filepath}, e as Error);
    return;
  }

  const validatorsBytes = getValidatorsBytesFromStateBytes(config, anchorStateBytes);
  if (validatorsBytes === null || !pubkeyCache.matchesValidators(validatorsBytes)) {
    pubkeyCache.reset();
    logger.debug("Discarded pubkeys file not matching anchor state", {filepath});
    return;
  }

  if (pubkeyCache.size > anchorValidatorCount) {
    pubkeyCache.truncate(anchorValidatorCount);
  }

  logger.debug("Loaded pubkeys file", {filepath, count: pubkeyCache.size, durationMs: Date.now() - start});
}

export function savePubkeysFile(pubkeyCache: PubkeyCache, filepath: string, logger: Logger): void {
  const start = Date.now();
  try {
    pubkeyCache.save(filepath);
    logger.debug("Saved pubkeys file", {filepath, count: pubkeyCache.size, durationMs: Date.now() - start});
  } catch (e) {
    logger.debug("Unable to save pubkeys file", {filepath}, e as Error);
  }
}
