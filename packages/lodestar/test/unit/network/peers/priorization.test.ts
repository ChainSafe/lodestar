import {expect} from "chai";
import PeerId from "peer-id";
import {phase0, altair} from "@chainsafe/lodestar-types";
import {prioritizePeers} from "../../../../src/network/peers/utils/prioritizePeers";
import {getAttnets} from "../../../utils/network";
import {RequestedSubnet} from "../../../../src/network/peers/utils";

type Result = ReturnType<typeof prioritizePeers>;

describe("network / peers / priorization", () => {
  const peers: PeerId[] = [];
  for (let i = 0; i < 8; i++) {
    const peer = new PeerId(Buffer.from(`peer-${i}`));
    peer.toB58String = () => `peer-${i}`;
    peers.push(peer);
  }

  const testCases: {
    id: string;
    connectedPeers: {id: PeerId; attnets: phase0.AttestationSubnets; syncnets: altair.SyncSubnets; score: number}[];
    activeAttnets: number[];
    activeSyncnets: number[];
    opts: {targetPeers: number; maxPeers: number};
    expectedResult: Result;
  }[] = [
    {
      id: "Request a subnet query when no peers are connected to it",
      connectedPeers: [],
      activeAttnets: [3],
      activeSyncnets: [],
      opts: {targetPeers: 1, maxPeers: 1},
      expectedResult: {
        peersToDisconnect: [],
        peersToConnect: 1,
        attnetQueries: [{subnet: 3, maxPeersToDiscover: 1, toSlot: 0}],
        syncnetQueries: [],
      },
    },
    {
      id: "Don't request a subnet query when enough peers are connected to it",
      connectedPeers: [{id: peers[0], syncnets: [], attnets: getAttnets([3]), score: 0}],
      activeAttnets: [3],
      activeSyncnets: [],
      opts: {targetPeers: 1, maxPeers: 1},
      expectedResult: {
        peersToDisconnect: [],
        peersToConnect: 0,
        attnetQueries: [],
        syncnetQueries: [],
      },
    },
    {
      id: "Disconnect worst peers without duty",
      connectedPeers: [
        {id: peers[0], syncnets: [], attnets: getAttnets([3]), score: 0},
        {id: peers[1], syncnets: [], attnets: [], score: 0},
        {id: peers[2], syncnets: [], attnets: [], score: -20},
        {id: peers[3], syncnets: [], attnets: [], score: -40},
      ],
      activeAttnets: [3],
      activeSyncnets: [],
      opts: {targetPeers: 1, maxPeers: 1},
      expectedResult: {
        // Peers sorted by score, excluding with future duties
        peersToDisconnect: [peers[3], peers[2], peers[1]],
        peersToConnect: 0,
        attnetQueries: [],
        syncnetQueries: [],
      },
    },
    {
      id: "Complete example: Disconnect peers and request a subnet query",
      connectedPeers: [
        {id: peers[0], syncnets: [], attnets: getAttnets([0, 1, 2]), score: 0},
        {id: peers[1], syncnets: [], attnets: getAttnets([0, 1, 2]), score: -10},
        {id: peers[2], syncnets: [], attnets: getAttnets([0, 1]), score: 0},
        {id: peers[3], syncnets: [], attnets: getAttnets([0]), score: -10},
        {id: peers[4], syncnets: [], attnets: getAttnets([2]), score: 0},
        {id: peers[5], syncnets: [], attnets: getAttnets([0, 2]), score: -20},
        {id: peers[6], syncnets: [], attnets: getAttnets([1, 2, 3]), score: 0},
        {id: peers[7], syncnets: [], attnets: getAttnets([1, 2]), score: -10},
      ],
      activeAttnets: [1, 3],
      activeSyncnets: [],
      opts: {targetPeers: 6, maxPeers: 6},
      expectedResult: {
        // Peers sorted by score, excluding with future duties
        peersToDisconnect: [peers[5], peers[3]],
        peersToConnect: 0,
        attnetQueries: [{subnet: 3, maxPeersToDiscover: 2, toSlot: 0}],
        syncnetQueries: [],
      },
    },

    // TODO: Add a test case with syncnets priorization
  ];

  for (const {id, connectedPeers, activeAttnets, activeSyncnets, opts, expectedResult} of testCases) {
    it(id, () => {
      const result = prioritizePeers(connectedPeers, toReqSubnet(activeAttnets), toReqSubnet(activeSyncnets), opts);
      expect(cleanResult(result)).to.deep.equal(cleanResult(expectedResult));
    });
  }

  function cleanResult(res: Result): Omit<Result, "peersToDisconnect"> & {peersToDisconnect: string[]} {
    return {
      ...res,
      peersToDisconnect: res.peersToDisconnect.map((peer) => peer.toB58String()),
    };
  }

  function toReqSubnet(subnets: number[]): RequestedSubnet[] {
    return subnets.map((subnet) => ({subnet, toSlot: 0}));
  }
});
