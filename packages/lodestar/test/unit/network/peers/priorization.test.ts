import {expect} from "chai";
import PeerId from "peer-id";
import {phase0} from "@chainsafe/lodestar-types";
import {AttSubnetQuery} from "../../../../src/network/peers/discover";
import {prioritizePeers} from "../../../../src/network/peers/utils/prioritizePeers";
import {getAttnets} from "../../../utils/network";

type Result = {peersToDisconnect: PeerId[]; peersToConnect: number; discv5Queries: AttSubnetQuery[]};

describe("network / peers / priorization", () => {
  const peers: PeerId[] = [];
  for (let i = 0; i < 8; i++) {
    const peer = new PeerId(Buffer.from(`peer-${i}`));
    peer.toB58String = () => `peer-${i}`;
    peers.push(peer);
  }

  const testCases: {
    id: string;
    connectedPeers: {id: PeerId; attnets: phase0.AttestationSubnets; score: number}[];
    activeSubnetIds: number[];
    opts: {targetPeers: number; maxPeers: number};
    expectedResult: Result;
  }[] = [
    {
      id: "Request a subnet query when no peers are connected to it",
      connectedPeers: [],
      activeSubnetIds: [3],
      opts: {targetPeers: 1, maxPeers: 1},
      expectedResult: {
        peersToDisconnect: [],
        peersToConnect: 1,
        discv5Queries: [{subnetId: 3, maxPeersToDiscover: 1}],
      },
    },
    {
      id: "Don't request a subnet query when enough peers are connected to it",
      connectedPeers: [{id: peers[0], attnets: getAttnets([3]), score: 0}],
      activeSubnetIds: [3],
      opts: {targetPeers: 1, maxPeers: 1},
      expectedResult: {
        peersToDisconnect: [],
        peersToConnect: 0,
        discv5Queries: [],
      },
    },
    {
      id: "Disconnect worst peers without duty",
      connectedPeers: [
        {id: peers[0], attnets: getAttnets([3]), score: 0},
        {id: peers[1], attnets: [], score: 0},
        {id: peers[2], attnets: [], score: -20},
        {id: peers[3], attnets: [], score: -40},
      ],
      activeSubnetIds: [3],
      opts: {targetPeers: 1, maxPeers: 1},
      expectedResult: {
        // Peers sorted by score, excluding with future duties
        peersToDisconnect: [peers[3], peers[2], peers[1]],
        peersToConnect: 0,
        discv5Queries: [],
      },
    },
    {
      id: "Complete example: Disconnect peers and request a subnet query",
      connectedPeers: [
        {id: peers[0], attnets: getAttnets([0, 1, 2]), score: 0},
        {id: peers[1], attnets: getAttnets([0, 1, 2]), score: -10},
        {id: peers[2], attnets: getAttnets([0, 1]), score: 0},
        {id: peers[3], attnets: getAttnets([0]), score: -10},
        {id: peers[4], attnets: getAttnets([2]), score: 0},
        {id: peers[5], attnets: getAttnets([0, 2]), score: -20},
        {id: peers[6], attnets: getAttnets([1, 2, 3]), score: 0},
        {id: peers[7], attnets: getAttnets([1, 2]), score: -10},
      ],
      activeSubnetIds: [1, 3],
      opts: {targetPeers: 6, maxPeers: 6},
      expectedResult: {
        // Peers sorted by score, excluding with future duties
        peersToDisconnect: [peers[5], peers[3]],
        peersToConnect: 0,
        discv5Queries: [{subnetId: 3, maxPeersToDiscover: 2}],
      },
    },
  ];

  for (const {id, connectedPeers, activeSubnetIds, opts, expectedResult} of testCases) {
    it(id, () => {
      const result = prioritizePeers(connectedPeers, activeSubnetIds, opts);
      expect(cleanResult(result)).to.deep.equal(cleanResult(expectedResult));
    });
  }

  function cleanResult(
    res: Result
  ): {peersToDisconnect: string[]; peersToConnect: number; discv5Queries: AttSubnetQuery[]} {
    return {
      ...res,
      peersToDisconnect: res.peersToDisconnect.map((peer) => peer.toB58String()),
    };
  }
});
