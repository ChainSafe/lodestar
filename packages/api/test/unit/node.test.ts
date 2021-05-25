import {config} from "@chainsafe/lodestar-config/minimal";
import {routes} from "../../src";
import {runGenericServerTest} from "../utils/genericServerTest";

describe("node", () => {
  const peerIdStr = "peerId";
  const nodePeer: routes.node.NodePeer = {
    peerId: peerIdStr,
    enr: "enr",
    lastSeenP2pAddress: "lastSeenP2pAddress",
    state: "connected",
    direction: "inbound",
  };

  runGenericServerTest<routes.node.Api, routes.node.ReqTypes>(config, routes.node, {
    getNetworkIdentity: {
      args: [],
      res: {
        data: {
          peerId: peerIdStr,
          enr: "enr",
          p2pAddresses: ["p2pAddresses"],
          discoveryAddresses: ["discoveryAddresses"],
          metadata: config.types.altair.Metadata.defaultValue(),
        },
      },
    },
    getPeers: {
      args: [{state: ["connected", "disconnected"], direction: ["inbound"]}],
      res: {data: [nodePeer], meta: {count: 1}},
    },
    getPeer: {
      args: [peerIdStr],
      res: {data: nodePeer},
    },
    getPeerCount: {
      args: [],
      res: {
        data: {
          disconnected: 1,
          connecting: 2,
          connected: 3,
          disconnecting: 4,
        },
      },
    },
    getNodeVersion: {
      args: [],
      res: {data: {version: "Lodestar/v0.20.0"}},
    },
    getSyncingStatus: {
      args: [],
      res: {data: {headSlot: 1, syncDistance: 2}},
    },
    getHealth: {
      args: [],
      res: undefined,
    },
  });
});
