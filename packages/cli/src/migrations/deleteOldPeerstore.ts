import * as fs from "node:fs";
import {LevelDbController} from "@chainsafe/lodestar-db";
import {ILogger} from "@chainsafe/lodestar-utils";

/**
 * As of libp2p v0.36.0 (https://github.com/libp2p/js-libp2p/commit/978eb3676fad5d5d50ddb28d1a7868f448cbb20b)
 * the peerstore format has changed in a breaking way.
 *
 * Because of that, we need to wipe the old peerstore if it exists.
 */
export async function deleteOldPeerstorePreV036(peerStoreDir: string, logger: ILogger): Promise<void> {
  const db = new LevelDbController({name: peerStoreDir}, {logger});
  await db.start();

  // only read a single key
  const keys = await db.keys({limit: 1});
  // the old peerstore had keys that look like so:
  const isOldPeerstore = Boolean(
    keys.find((k) => {
      const key = k.toString();
      return (
        key.startsWith("/peers/addrs") ||
        key.startsWith("/peers/keys") ||
        key.startsWith("/peers/metadata") ||
        key.startsWith("/peers/proto")
      );
    })
  );
  await db.stop();

  if (isOldPeerstore) {
    if (peerStoreDir.endsWith("/")) {
      peerStoreDir = peerStoreDir.slice(0, peerStoreDir.length - 1);
    }
    fs.rmSync(peerStoreDir, {recursive: true, force: true});
    logger.info("Deleted old peerstore");
  }
}
