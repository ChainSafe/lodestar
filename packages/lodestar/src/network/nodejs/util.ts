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
 * @param networkOpts
 * @param peerStoreDir
 */
export async function createNodeJsLibp2p(
  peerIdOrPromise: PeerId | Promise<PeerId>,
  networkOpts: Partial<INetworkOptions> = {},
  nodeJsLibp2pOpts: NodeJsLibp2pOpts = {}
): Promise<LibP2p> {
  const peerId = await Promise.resolve(peerIdOrPromise);
  const localMultiaddrs = networkOpts.localMultiaddrs || defaultNetworkOptions.localMultiaddrs;
  const bootMultiaddrs = networkOpts.bootMultiaddrs || defaultNetworkOptions.bootMultiaddrs;
  const enr = networkOpts.discv5?.enr;
  const {peerStoreDir, disablePeerDiscovery} = nodeJsLibp2pOpts;

  if (enr !== undefined && typeof enr !== "string") {
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

  // Append discv5.bootEnrs to bootMultiaddrs if requested
  if (networkOpts.connectToDiscv5Bootnodes) {
    if (!networkOpts.bootMultiaddrs) {
      networkOpts.bootMultiaddrs = [];
    }
    if (!networkOpts.discv5) {
      networkOpts.discv5 = defaultDiscv5Options;
    }
    for (const enrOrStr of networkOpts.discv5.bootEnrs) {
      const enr = typeof enrOrStr === "string" ? ENR.decodeTxt(enrOrStr) : enrOrStr;
      const fullMultiAddr = await enr.getFullMultiaddr("tcp");
      const multiaddrWithPeerId = fullMultiAddr?.toString();
      if (multiaddrWithPeerId) {
        networkOpts.bootMultiaddrs.push(multiaddrWithPeerId);
      }
    }
  }

  return new NodejsNode({
    peerId,
    addresses: {listen: localMultiaddrs},
    datastore,
    bootMultiaddrs: bootMultiaddrs,
    maxConnections: networkOpts.maxPeers,
    minConnections: networkOpts.targetPeers,
    // If peer discovery is enabled let the default in NodejsNode
    peerDiscovery: disablePeerDiscovery ? [] : undefined,
  });
}
