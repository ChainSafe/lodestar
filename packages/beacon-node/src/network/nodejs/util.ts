import {PeerId} from "@libp2p/interface-peer-id";
import {Registry} from "prom-client";
import {ENR} from "@chainsafe/discv5";
import {Libp2p} from "../interface.js";
import {Eth2PeerDataStore} from "../peers/datastore.js";
import {defaultNetworkOptions, NetworkOptions} from "../options.js";
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
  const {peerStoreDir, disablePeerDiscovery} = nodeJsLibp2pOpts;

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
    for (const enrOrStr of networkOpts.discv5?.bootEnrs ?? []) {
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
    hideAgentVersion: networkOpts.private,
    mdns: networkOpts.mdns,
  });
}
