import {type PubkeyCache} from "@chainsafe/lodestar-z/pubkeys";
import {BeaconStateAllForks} from "@lodestar/state-transition";
import {Logger, byteArrayEquals} from "@lodestar/utils";

/**
 * Best effort load of a pubkey cache saved by a previous run, to skip decompressing every validator pubkey on boot.
 * Must be called before any worker uses the cache.
 */
export function loadPubkeysFile(
  pubkeyCache: PubkeyCache,
  filepath: string,
  anchorState: BeaconStateAllForks,
  maxCapacity: number,
  logger: Logger
): void {
  const start = Date.now();
  try {
    pubkeyCache.load(filepath, maxCapacity);
  } catch (e) {
    logger.debug("Unable to load pubkeys file", {filepath}, e as Error);
    return;
  }

  // load() only checks framing and checksum, so reject a file from another chain. Checking the endpoints
  // suffices since the registry is append-only.
  const overlap = Math.min(pubkeyCache.size, anchorState.validators.length);
  for (const index of overlap > 0 ? [0, overlap - 1] : []) {
    if (!byteArrayEquals(pubkeyCache.getPubkeyBytesOrThrow(index), anchorState.validators.getReadonly(index).pubkey)) {
      pubkeyCache.reset();
      logger.debug("Discarded pubkeys file not matching anchor state", {filepath, index});
      return;
    }
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
