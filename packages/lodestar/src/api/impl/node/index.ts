import {routes} from "@chainsafe/lodestar-api";
import {createKeypairFromPeerId} from "@chainsafe/discv5";
import {formatNodePeer} from "./utils";
import {ApiError} from "../errors";
import {ApiModules} from "../types";
import {IApiOptions} from "../../options";

export function getNodeApi(opts: IApiOptions, {network, sync}: Pick<ApiModules, "network" | "sync">): routes.node.Api {
  return {
    async getNetworkIdentity() {
      const enr = network.getEnr();
      const keypair = createKeypairFromPeerId(network.peerId);
      const discoveryAddresses = [
        enr?.getLocationMultiaddr("tcp")?.toString() ?? null,
        enr?.getLocationMultiaddr("udp")?.toString() ?? null,
      ].filter((addr): addr is string => Boolean(addr));

      return {
        data: {
          peerId: network.peerId.toB58String(),
          enr: enr?.encodeTxt(keypair.privateKey) || "",
          discoveryAddresses,
          p2pAddresses: network.localMultiaddrs.map((m) => m.toString()),
          metadata: network.metadata,
        },
      };
    },

    async getPeer(peerIdStr) {
      const connections = network.getConnectionsByPeer().get(peerIdStr);
      if (!connections) {
        throw new ApiError(404, "Node has not seen this peer");
      }
      return {data: formatNodePeer(peerIdStr, connections)};
    },

    async getPeers(filters) {
      const {state, direction} = filters || {};
      const peers = Array.from(network.getConnectionsByPeer().entries())
        .map(([peerIdStr, connections]) => formatNodePeer(peerIdStr, connections))
        .filter(
          (nodePeer) =>
            (!state || state.length === 0 || state.includes(nodePeer.state)) &&
            (!direction || direction.length === 0 || (nodePeer.direction && direction.includes(nodePeer.direction)))
        );

      return {
        data: peers,
        meta: {count: peers.length},
      };
    },

    async getPeerCount() {
      // TODO: Implement
      return {
        data: {
          disconnected: 0,
          connecting: 0,
          connected: 0,
          disconnecting: 0,
        },
      };
    },

    async getNodeVersion() {
      return {
        data: {
          version: `Lodestar/${opts.version || "dev"}`,
        },
      };
    },

    async getSyncingStatus() {
      return {data: sync.getSyncStatus()};
    },

    async getHealth() {
      if (sync.getSyncStatus().isSyncing) {
        // 200: Node is ready
        return routes.node.NodeHealth.SYNCING;
      } else {
        // 206: Node is syncing but can serve incomplete data
        return routes.node.NodeHealth.READY;
      }
      // else {
      //   503: Node not initialized or having issues
      //   NOTE: Lodestar does not start its API until fully initialized, so this status can never be served
      // }
    },
  };
}
