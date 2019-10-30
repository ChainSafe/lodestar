/**
 * @module network/nodejs
 */

import fs from "fs";
import PeerId from "peer-id";
// @ts-ignore
import promisify from "promisify-es6";
import LibP2p from "libp2p";
import {NodejsNode} from ".";
import {initializePeerInfo} from "../util";
import {INetworkOptions} from "../options";
import defaults from "../defaults";

/**
 * Save a peer id to disk
 */
export async function savePeerId(path: string, peerId: PeerId): Promise<void> {
  await promisify(fs.writeFile)(path, JSON.stringify(peerId.toJSON(), null, 2));
}

/**
 * Load a peer id from disk
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function loadPeerId(path: string): Promise<PeerId> {
  const data = await promisify(fs.readFile)(path);
  return await promisify(PeerId.createFromJSON)(JSON.parse(data));
}

/**
 * 
 * @param peerId Create an instance of NodejsNode asynchronously
 */
export async function createNodeJsLibp2p(peerIdOrPromise: PeerId | Promise<PeerId>, 
  network: Partial<INetworkOptions> = {}): Promise<LibP2p> {
  const peerId = await Promise.resolve(peerIdOrPromise);
  const multiaddrs = network.multiaddrs || defaults.multiaddrs;
  const bootnodes = network.bootnodes || defaults.bootnodes;
  const peerInfo = await initializePeerInfo(peerId, multiaddrs);
  return new NodejsNode({peerInfo, bootnodes: bootnodes});
}