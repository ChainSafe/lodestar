import {expect} from "chai";
import {PeerId} from "@libp2p/interface-peer-id";
import {createSecp256k1PeerId} from "@libp2p/peer-id-factory";
import {BitArray} from "@chainsafe/ssz";
import {ATTESTATION_SUBNET_COUNT} from "@lodestar/params";
import {
  ExcessPeerDisconnectReason,
  prioritizePeers,
  PrioritizePeersOpts,
} from "../../../../src/network/peers/utils/prioritizePeers.js";
import {getAttnets, getSyncnets} from "../../../utils/network.js";
import {RequestedSubnet} from "../../../../src/network/peers/utils/index.js";

type Result = ReturnType<typeof prioritizePeers>;

describe("network / peers / priorization", async () => {
  const peers: PeerId[] = [];
  for (let i = 0; i < 8; i++) {
    const peer = await createSecp256k1PeerId();
    peer.toString = () => `peer-${i}`;
    peers.push(peer);
  }
  const none = BitArray.fromBitLen(ATTESTATION_SUBNET_COUNT);

  const testCases: {
    id: string;
    connectedPeers: Parameters<typeof prioritizePeers>[0];
    activeAttnets: number[];
    activeSyncnets: number[];
    opts: PrioritizePeersOpts;
    expectedResult: Result;
  }[] = [
    {
      id: "Request a subnet query when no peers are connected to it",
      connectedPeers: [],
      activeAttnets: [3],
      activeSyncnets: [],
      opts: {targetPeers: 1, maxPeers: 1, targetSubnetPeers: 1},
      expectedResult: {
        peersToDisconnect: new Map(),
        peersToConnect: 1,
        attnetQueries: [{subnet: 3, maxPeersToDiscover: 1, toSlot: 0}],
        syncnetQueries: [],
      },
    },
    {
      id: "Don't request a subnet query when enough peers are connected to it",
      connectedPeers: [{id: peers[0], direction: null, syncnets: none, attnets: getAttnets([3]), score: 0}],
      activeAttnets: [3],
      activeSyncnets: [],
      opts: {targetPeers: 1, maxPeers: 1, targetSubnetPeers: 1},
      expectedResult: {
        peersToDisconnect: new Map(),
        peersToConnect: 0,
        attnetQueries: [],
        syncnetQueries: [],
      },
    },
    {
      id: "Disconnect low score peers without duty",
      connectedPeers: [
        {id: peers[0], direction: null, syncnets: none, attnets: getAttnets([3]), score: 0},
        {id: peers[1], direction: null, syncnets: none, attnets: getAttnets([5]), score: -5},
        {id: peers[2], direction: null, syncnets: none, attnets: getAttnets([5]), score: -20},
        {id: peers[3], direction: null, syncnets: none, attnets: getAttnets([5]), score: -40},
      ],
      activeAttnets: [3],
      activeSyncnets: [],
      opts: {targetPeers: 1, maxPeers: 1, targetSubnetPeers: 1},
      expectedResult: {
        // Peers sorted by score, excluding with future duties
        peersToDisconnect: new Map<ExcessPeerDisconnectReason, PeerId[]>([
          [ExcessPeerDisconnectReason.LOW_SCORE, [peers[3], peers[2], peers[1]]],
        ]),
        peersToConnect: 0,
        attnetQueries: [],
        syncnetQueries: [],
      },
    },
    {
      id: "Disconnect no long-lived-subnet peers without duty",
      connectedPeers: [
        {id: peers[0], direction: null, syncnets: none, attnets: getAttnets([3]), score: 0},
        {id: peers[1], direction: null, syncnets: none, attnets: none, score: -0.1},
        {id: peers[2], direction: null, syncnets: none, attnets: none, score: -0.2},
        {id: peers[3], direction: null, syncnets: none, attnets: none, score: -0.3},
      ],
      activeAttnets: [3],
      activeSyncnets: [],
      opts: {targetPeers: 1, maxPeers: 1, targetSubnetPeers: 1},
      expectedResult: {
        // Peers sorted by score, excluding with future duties
        peersToDisconnect: new Map<ExcessPeerDisconnectReason, PeerId[]>([
          [ExcessPeerDisconnectReason.NO_LONG_LIVED_SUBNET, [peers[3], peers[2], peers[1]]],
        ]),
        peersToConnect: 0,
        attnetQueries: [],
        syncnetQueries: [],
      },
    },
    {
      id: "Disconnect no-duty peers that's too grouped in a subnet",
      connectedPeers: [
        // should not drop this peer or duty peers drop below min value
        {id: peers[0], direction: null, syncnets: none, attnets: getAttnets([1, 3]), score: 0},
        // below peers are too grouped into subnet 1
        {id: peers[1], direction: null, syncnets: none, attnets: getAttnets([1, 4, 6]), score: 0},
        {id: peers[2], direction: null, syncnets: none, attnets: getAttnets([1, 4]), score: 0},
        {id: peers[3], direction: null, syncnets: none, attnets: getAttnets([1]), score: 0},
        // should not remove this peer due or syncnet peers would drop below min value
        {id: peers[4], direction: null, syncnets: getSyncnets([2, 3]), attnets: getAttnets([1]), score: 0},
      ],
      activeAttnets: [3],
      activeSyncnets: [2],
      opts: {targetPeers: 1, maxPeers: 1, targetSubnetPeers: 1},
      expectedResult: {
        // Peers sorted by long lived subnets
        peersToDisconnect: new Map<ExcessPeerDisconnectReason, PeerId[]>([
          [ExcessPeerDisconnectReason.TOO_GROUPED_SUBNET, [peers[3], peers[2], peers[1]]],
        ]),
        peersToConnect: 0,
        attnetQueries: [],
        syncnetQueries: [],
      },
    },
    {
      id: "Disconnect no-duty peers that's too grouped in a subnet - ignore maxPeersSubnet",
      connectedPeers: [
        // should not drop this peer or duty peers drop below min value
        {id: peers[0], direction: null, syncnets: none, attnets: getAttnets([1, 3]), score: 0},
        // below peers are too grouped into subnet 1
        // but cannot remove them due to syncnet requirement
        {id: peers[1], direction: null, syncnets: getSyncnets([2]), attnets: getAttnets([1, 4, 6]), score: 0},
        {id: peers[2], direction: null, syncnets: getSyncnets([2]), attnets: getAttnets([1, 4]), score: 0},
        // biggest maxPeerSubnet is 1 (3 peers) but cannot remove all of them
        // 2nd biggest maxPeerSubnet is 7, should remove peers from that subnet
        {id: peers[3], direction: null, syncnets: none, attnets: getAttnets([7]), score: 0},
        // peer 4 has more long lived subnets than peer 3, should not remove it
        {id: peers[4], direction: null, syncnets: none, attnets: getAttnets([7, 8]), score: 0},
      ],
      activeAttnets: [3],
      activeSyncnets: [2],
      opts: {targetPeers: 1, maxPeers: 1, targetSubnetPeers: 1},
      expectedResult: {
        // Peers sorted by long lived subnets
        peersToDisconnect: new Map<ExcessPeerDisconnectReason, PeerId[]>([
          [ExcessPeerDisconnectReason.TOO_GROUPED_SUBNET, [peers[3]]],
        ]),
        peersToConnect: 0,
        attnetQueries: [],
        syncnetQueries: [],
      },
    },
    {
      id: "Keep at least 10% of outbound peers",
      connectedPeers: [
        // Peers with a least one attnet, distributed such that 1 peer / subnet.
        // Target to disconnect 4 of them, while keeping 25% outbound = 2.
        // So should disconnect 4 peers with worse score while keeping 2 outbound with best score.
        {id: peers[0], direction: "inbound", syncnets: none, attnets: getAttnets([0]), score: 0},
        {id: peers[1], direction: "inbound", syncnets: none, attnets: getAttnets([1]), score: -10},
        {id: peers[2], direction: "inbound", syncnets: none, attnets: getAttnets([2]), score: -20},
        {id: peers[3], direction: "inbound", syncnets: none, attnets: getAttnets([3]), score: -30},
        {id: peers[4], direction: "outbound", syncnets: none, attnets: getAttnets([4]), score: -40},
        {id: peers[5], direction: "outbound", syncnets: none, attnets: getAttnets([5]), score: -50},
        {id: peers[6], direction: "outbound", syncnets: none, attnets: getAttnets([6]), score: -60},
        {id: peers[7], direction: "outbound", syncnets: none, attnets: getAttnets([7]), score: -70},
      ],
      activeAttnets: [],
      activeSyncnets: [],
      opts: {targetPeers: 4, maxPeers: 4, targetSubnetPeers: 1, outboundPeersRatio: 2 / 8},
      expectedResult: {
        // Peers sorted by score, excluding with future duties
        peersToDisconnect: new Map<ExcessPeerDisconnectReason, PeerId[]>([
          // Worse outbound [7,6] + next worse peers (inbound) [3,2]
          [ExcessPeerDisconnectReason.LOW_SCORE, [peers[7], peers[6], peers[3], peers[2]]],
        ]),
        peersToConnect: 0,
        attnetQueries: [],
        syncnetQueries: [],
      },
    },
    {
      id: "Complete example: Disconnect peers and request a subnet query",
      connectedPeers: [
        {id: peers[0], direction: null, syncnets: none, attnets: getAttnets([0, 1, 2]), score: 0},
        {id: peers[1], direction: null, syncnets: none, attnets: getAttnets([0, 1, 2]), score: -10},
        {id: peers[2], direction: null, syncnets: none, attnets: getAttnets([0, 1]), score: 0},
        {id: peers[3], direction: null, syncnets: none, attnets: getAttnets([0]), score: -10},
        {id: peers[4], direction: null, syncnets: none, attnets: getAttnets([2]), score: 0},
        {id: peers[5], direction: null, syncnets: none, attnets: getAttnets([0, 2]), score: -20},
        {id: peers[6], direction: null, syncnets: none, attnets: getAttnets([1, 2, 3]), score: 0},
        {id: peers[7], direction: null, syncnets: none, attnets: getAttnets([1, 2]), score: -10},
      ],
      activeAttnets: [1, 3],
      activeSyncnets: [],
      opts: {targetPeers: 6, maxPeers: 6, targetSubnetPeers: 2},
      expectedResult: {
        // Peers sorted by score, excluding with future duties
        peersToDisconnect: new Map<ExcessPeerDisconnectReason, PeerId[]>([
          [ExcessPeerDisconnectReason.LOW_SCORE, [peers[5], peers[3]]],
        ]),
        peersToConnect: 0,
        attnetQueries: [{subnet: 3, maxPeersToDiscover: 1, toSlot: 0}],
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
    const toCleanResult = (peersToDisconnect: Map<string, PeerId[]>): string[] => {
      const result: string[] = [];
      for (const [reason, peers] of peersToDisconnect) {
        if (peers.length > 0) {
          result.push(reason);
        }
        result.push(...peers.map((peer) => peer.toString()));
      }
      return result;
    };
    return {
      ...res,
      peersToDisconnect: toCleanResult(res.peersToDisconnect),
    };
  }

  function toReqSubnet(subnets: number[]): RequestedSubnet[] {
    return subnets.map((subnet) => ({subnet, toSlot: 0}));
  }
});
