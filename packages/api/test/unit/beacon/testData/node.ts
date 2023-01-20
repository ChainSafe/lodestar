import {ssz} from "@lodestar/types";
import {Api, NodePeer} from "../../../../src/beacon/routes/node.js";
import {GenericServerTestCases} from "../../../utils/genericServerTest.js";

const peerIdStr = "peerId";
const nodePeer: NodePeer = {
  peerId: peerIdStr,
  enr: "enr",
  lastSeenP2pAddress: "lastSeenP2pAddress",
  state: "connected",
  direction: "inbound",
};

export const testData: GenericServerTestCases<Api> = {
  getNetworkIdentity: {
    args: [],
    res: {
      data: {
        peerId: peerIdStr,
        enr: "enr",
        p2pAddresses: ["p2pAddresses"],
        discoveryAddresses: ["discoveryAddresses"],
        metadata: ssz.altair.Metadata.defaultValue(),
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
    res: {data: {headSlot: "1", syncDistance: "2", isSyncing: false, isOptimistic: true}},
  },
  getHealth: {
    args: [],
    res: undefined,
  },
};
