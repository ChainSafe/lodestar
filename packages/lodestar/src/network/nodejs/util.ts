/**
 * @module network/nodejs
 */

import PeerId from "peer-id";
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

  let datastore: undefined | LevelDatastore = undefined;
  if (peerStoreDir) {
    datastore = new LevelDatastore(peerStoreDir);
    await datastore.open();
  }

  return new NodejsNode({
    peerId,
    addresses: {listen: localMultiaddrs},
    datastore,
    bootMultiaddrs: bootMultiaddrs,
    discv5: network.discv5 || defaultDiscv5Options,
    maxConnections: network.maxPeers,
    minConnections: network.targetPeers,
    // If peer discovery is enabled let the default in NodejsNode
    peerDiscovery: disablePeerDiscovery ? [] : undefined,
  });
}
