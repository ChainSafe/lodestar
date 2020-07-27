/**
 * @module network/nodejs
 */

import fs from "fs";
import PeerId from "peer-id";
import {promisify} from "es6-promisify";
import LibP2p from "libp2p";
import {NodejsNode} from ".";
import {INetworkOptions} from "../options";
import defaults from "../defaults";
import {isLocalMultiAddr, clearMultiaddrUDP} from "..";
import {ENR} from "@chainsafe/discv5";

/**
 * Save a peer id to disk
 */
export async function savePeerId(path: string, peerId: PeerId): Promise<void> {
  await promisify(fs.writeFile)(path, JSON.stringify(peerId.toJSON(), null, 2));
}

/**
 * Load a peer id from disk
 */
export async function loadPeerIdFromJsonFile(path: string): Promise<PeerId> {
  const data = fs.readFileSync(path, "utf-8");
  return await PeerId.createFromJSON(JSON.parse(data));
}

/**
 *
 * @param peerIdOrPromise Create an instance of NodejsNode asynchronously
 * @param network
 * @param autoDial
 */
export async function createNodeJsLibp2p(
  peerIdOrPromise: PeerId | Promise<PeerId>,
  network: Partial<INetworkOptions> = {},
  autoDial = true
): Promise<LibP2p> {
  const peerId = await Promise.resolve(peerIdOrPromise);
  const multiaddrs = network.multiaddrs || defaults.multiaddrs;
  const bootnodes = network.bootnodes || defaults.bootnodes;
  const enr = network.discv5?.enr;
  if (enr && typeof enr !== "string") {
    const enrInstance = enr as ENR;
    if (enrInstance.multiaddrUDP && !isLocalMultiAddr(enrInstance.multiaddrUDP)) {
      clearMultiaddrUDP(enrInstance);
    }
  }
  return new NodejsNode({
    peerId,
    addresses: {listen: multiaddrs},
    autoDial,
    bootnodes: bootnodes,
    discv5: network.discv5
  });
}
