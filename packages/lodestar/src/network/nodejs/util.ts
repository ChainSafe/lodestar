/**
 * @module network/nodejs
 */

import fs from "fs";
import PeerId from "peer-id";
import promisify from "promisify-es6";

/**
 * Save a peer id to disk
 */
export async function savePeerId(path: string, peerId: PeerId): Promise<void> {
  await promisify(fs.writeFile)(path, JSON.stringify(peerId.toJSON(), null, 2));
}

/**
 * Load a peer id from disk
 */
export async function loadPeerId(path: string): Promise<PeerId> {
  const data = await promisify(fs.readFile)(path);
  return await promisify(PeerId.createFromJSON)(JSON.parse(data));
}
