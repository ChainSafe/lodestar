import {PeerId} from "@libp2p/interface-peer-id";
import {Registry} from "prom-client";
import {ENR, SignableENR} from "@chainsafe/discv5";
import {Libp2p} from "../interface.js";
import {Eth2PeerDataStore} from "../peers/datastore.js";
import {defaultDiscv5Options, defaultNetworkOptions, NetworkOptions} from "../options.js";
import {isLocalMultiAddr, clearMultiaddrUDP} from "../util.js";
import {createNodejsLibp2p as _createNodejsLibp2p} from "./bundle.js";

export type NodeJsLibp2pOpts = {
  peerStoreDir?: string;
  disablePeerDiscovery?: boolean;
  metrics?: boolean;
  metricsRegistry?: Registry;
};

/**
 *
 * @param peerIdOrPromise Create an instance of NodejsNode asynchronously
 * @param networkOpts
 * @param peerStoreDir
 */
export async function createNodeJsLibp2p(
  peerIdOrPromise: PeerId | Promise<PeerId>,
  networkOpts: Partial<NetworkOptions> = {},
  nodeJsLibp2pOpts: NodeJsLibp2pOpts = {}
): Promise<Libp2p> {
  const peerId = await Promise.resolve(peerIdOrPromise);
  const localMultiaddrs = networkOpts.localMultiaddrs || defaultNetworkOptions.localMultiaddrs;
  const bootMultiaddrs = networkOpts.bootMultiaddrs || defaultNetworkOptions.bootMultiaddrs;
  const enr = networkOpts.discv5?.enr;
  const {peerStoreDir, disablePeerDiscovery} = nodeJsLibp2pOpts;

  if (enr !== undefined && typeof enr !== "string") {
    if (enr instanceof SignableENR) {
      if (enr.getLocationMultiaddr("udp") && !isLocalMultiAddr(enr.getLocationMultiaddr("udp"))) {
        clearMultiaddrUDP(enr);
      }
    } else {
      throw Error("network.discv5.enr must be an instance of ENR");
    }
  }

  let datastore: undefined | Eth2PeerDataStore = undefined;
  if (peerStoreDir) {
    datastore = new Eth2PeerDataStore(peerStoreDir);
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

  return _createNodejsLibp2p({
    peerId,
    addresses: {listen: localMultiaddrs},
    datastore,
    bootMultiaddrs: bootMultiaddrs,
    maxConnections: networkOpts.maxPeers,
    minConnections: networkOpts.targetPeers,
    // If peer discovery is enabled let the default in NodejsNode
    peerDiscovery: disablePeerDiscovery ? [] : undefined,
    metrics: nodeJsLibp2pOpts.metrics,
    metricsRegistry: nodeJsLibp2pOpts.metricsRegistry,
    lodestarVersion: networkOpts.version,
    mdns: networkOpts.mdns,
  });
}
