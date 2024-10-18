import {routes} from "@lodestar/api";
import {ApplicationMethods} from "@lodestar/api/server";
import {ApiError} from "../errors.js";
import {ApiModules} from "../types.js";
import {ApiOptions} from "../../options.js";

export function getNodeApi(
  opts: ApiOptions,
  {network, sync}: Pick<ApiModules, "network" | "sync">
): ApplicationMethods<routes.node.Endpoints> {
  return {
    async getNetworkIdentity() {
      return {
        data: await network.getNetworkIdentity(),
      };
    },

    async getPeer({peerId}) {
      const peer = await network.dumpPeer(peerId);
      if (!peer) {
        throw new ApiError(404, "Node has not seen this peer");
      }
      return {data: peer};
    },

    async getPeers({state, direction}) {
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

    async getHealth({syncingStatus}) {
      if (syncingStatus != null && (syncingStatus < 100 || syncingStatus > 599)) {
        throw new ApiError(400, `Invalid syncing status code: ${syncingStatus}`);
      }

      const {isSyncing, isOptimistic, elOffline} = sync.getSyncStatus();

      if (isSyncing || isOptimistic || elOffline) {
        // 206: Node is syncing but can serve incomplete data
        return {status: syncingStatus ?? routes.node.NodeHealth.SYNCING};
      }
      // 200: Node is ready
      return {status: routes.node.NodeHealth.READY};
      // else {
      //   503: Node not initialized or having issues
      //   NOTE: Lodestar does not start its API until fully initialized, so this status can never be served
      // }
    },
  };
}
