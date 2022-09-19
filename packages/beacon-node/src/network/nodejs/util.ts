import {PeerId} from "@libp2p/interface-peer-id";
import {Libp2p} from "libp2p";
import {Eth2PeerDataStore} from "../peers/datastore.js";
import {defaultNetworkOptions, INetworkOptions} from "../options.js";
import {createNodejsLibp2p as _createNodejsLibp2p} from "./bundle.js";

export type NodeJsLibp2pOpts = {
  peerStoreDir?: string;
  disablePeerDiscovery?: boolean;
  metrics?: boolean;
};

/**
 *
 * @param peerIdOrPromise Create an instance of NodejsNode asynchronously
 * @param networkOpts
 * @param peerStoreDir
 */
export async function createNodeJsLibp2p(
  peerIdOrPromise: PeerId | Promise<PeerId>,
  networkOpts: INetworkOptions = {},
  nodeJsLibp2pOpts: NodeJsLibp2pOpts = {}
): Promise<Libp2p> {
  const peerId = await Promise.resolve(peerIdOrPromise);
  const {peerStoreDir, disablePeerDiscovery} = nodeJsLibp2pOpts;

  let datastore: undefined | Eth2PeerDataStore = undefined;
  if (peerStoreDir) {
    datastore = new Eth2PeerDataStore(peerStoreDir);
    await datastore.open();
  }

  const listenAddress = networkOpts.listenAddress ?? defaultNetworkOptions.listenAddress;
  const port = networkOpts.port ?? defaultNetworkOptions.port;

  return _createNodejsLibp2p({
    peerId,
    addresses: {listen: [getIp4MultiaddStr(listenAddress, "tcp", port)]},
    datastore,
    maxConnections: networkOpts.maxPeers,
    minConnections: networkOpts.targetPeers,
    // If peer discovery is enabled let the default in NodejsNode
    peerDiscovery: disablePeerDiscovery ? [] : undefined,
    metrics: nodeJsLibp2pOpts.metrics,
  });
}

/** Typesafe wrapper to format ip4 multiaddr string. Just using `` will accept undefined as valid */
export function getIp4MultiaddStr(listenAddress: string, protocol: "tcp" | "udp", port: number): string {
  return `/ip4/${listenAddress}/${protocol}/${port}`;
}
