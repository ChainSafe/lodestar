import {routes, ServerApi} from "@lodestar/api";
import {ApiError} from "../errors.js";
import {ApiModules} from "../types.js";
import {ApiOptions} from "../../options.js";

export function getNodeApi(
  opts: ApiOptions,
  {network, sync}: Pick<ApiModules, "network" | "sync">
): ServerApi<routes.node.Api> {
  return {
    async getNetworkIdentity() {
      const enr = await network.getEnr();
      const discoveryAddresses = [
        enr?.getLocationMultiaddr("tcp")?.toString() ?? null,
        enr?.getLocationMultiaddr("udp")?.toString() ?? null,
      ].filter((addr): addr is string => Boolean(addr));

      return {
        data: {
          peerId: network.peerId.toString(),
          enr: enr?.encodeTxt() || "",
          discoveryAddresses,
          p2pAddresses: network.localMultiaddrs.map((m) => m.toString()),
          metadata: await network.getMetadata(),
        },
      };
    },

    async getPeer(peerIdStr) {
      const peer = await network.dumpPeer(peerIdStr);
      if (!peer) {
        throw new ApiError(404, "Node has not seen this peer");
      }
      return {data: peer};
    },

    async getPeers(filters) {
      const {state, direction} = filters || {};
      const peers = (await network.dumpPeers()).filter(
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
      // TODO: Implement disconnect count with on-disk persistence
      const data = {
        disconnected: 0,
        connecting: 0,
        connected: 0,
        disconnecting: 0,
      };

      for (const peer of await network.dumpPeers()) {
        data[peer.state]++;
      }

      return {
        data,
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

    async getHealth(_req, res) {
      if (sync.getSyncStatus().isSyncing) {
        // 206: Node is syncing but can serve incomplete data
        res?.code(routes.node.NodeHealth.SYNCING);
      } else {
        // 200: Node is ready
        res?.code(routes.node.NodeHealth.READY);
      }
      // else {
      //   503: Node not initialized or having issues
      //   NOTE: Lodestar does not start its API until fully initialized, so this status can never be served
      // }
    },
  };
}
