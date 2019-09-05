/**
 * @module network/nodejs
 */

import PeerId from "peer-id";

/**
 * Save a peer id to disk
 */
export async function savePeerId(peerId: PeerId, path: string): Promise<void> {
}

/**
 * Load a peer id from disk
 */
export async function loadPeerId(path: string): Promise<PeerId> {
  return null as PeerId;
}
