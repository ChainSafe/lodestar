/**
 * @module network/nodejs
 */

import PeerId from "peer-id";

/**
 * Save a peer id to disk
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function savePeerId(peerId: PeerId, path: string): Promise<void> {
}

/**
 * Load a peer id from disk
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function loadPeerId(path: string): Promise<PeerId> {
  return null as unknown as PeerId;
}
