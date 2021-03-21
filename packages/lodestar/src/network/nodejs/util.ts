/**
 * @module network/nodejs
 */

import fs from "fs";
import PeerId from "peer-id";
import {promisify} from "es6-promisify";
import LibP2p from "libp2p";
import {NodejsNode} from "./bundle";
import {defaultDiscv5Options, defaultNetworkOptions, INetworkOptions} from "../options";
import {isLocalMultiAddr, clearMultiaddrUDP} from "..";
import {ENR} from "@chainsafe/discv5";
import LevelDatastore from "datastore-level";

export type NodeJsLibp2pOpts = {
  peerStoreDir?: string;
  disablePeerDiscovery?: boolean;
};

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
 * @param peerStoreDir
 */
export async function createNodeJsLibp2p(
  peerIdOrPromise: PeerId | Promise<PeerId>,
  network: Partial<INetworkOptions> = {},
  nodeJsLibp2pOpts: NodeJsLibp2pOpts = {}
): Promise<LibP2p> {
  const peerId = await Promise.resolve(peerIdOrPromise);
  const localMultiaddrs = network.localMultiaddrs || defaultNetworkOptions.localMultiaddrs;
  const bootMultiaddrs = network.bootMultiaddrs || defaultNetworkOptions.bootMultiaddrs;
  const enr = network.discv5?.enr;
  const {peerStoreDir, disablePeerDiscovery} = nodeJsLibp2pOpts;

  if (enr && typeof enr !== "string") {
    if (enr instanceof ENR) {
      if (enr.getLocationMultiaddr("udp") && !isLocalMultiAddr(enr.getLocationMultiaddr("udp"))) {
        clearMultiaddrUDP(enr);
      }
    } else {
      throw Error("network.discv5.enr must be an instance of ENR");
    }
  }

  return new NodejsNode({
    peerId,
    addresses: {listen: localMultiaddrs},
    datastore: peerStoreDir ? new LevelDatastore(peerStoreDir) : undefined,
    bootMultiaddrs: bootMultiaddrs,
    discv5: network.discv5 || defaultDiscv5Options,
    maxConnections: network.maxPeers,
    minConnections: network.targetPeers,
    // If peer discovery is enabled let the default in NodejsNode
    peerDiscovery: disablePeerDiscovery ? [] : undefined,
  });
}
