import {BitArray} from "@chainsafe/ssz";
import {generateKeyPair} from "@libp2p/crypto/keys";
import {PeerId} from "@libp2p/interface";
import {peerIdFromPrivateKey} from "@libp2p/peer-id";
import {ATTESTATION_SUBNET_COUNT, SLOTS_PER_EPOCH} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {describe, expect, it} from "vitest";
import {RequestedSubnet} from "../../../../src/network/peers/utils/index.js";
import {
  ExcessPeerDisconnectReason,
  PrioritizePeersOpts,
  prioritizePeers,
  sortPeersToPrune,
} from "../../../../src/network/peers/utils/prioritizePeers.js";
import {getAttnets, getSyncnets} from "../../../utils/network.js";

type Result = ReturnType<typeof prioritizePeers>;

describe("network / peers / priorization", async () => {
  const peers: PeerId[] = [];
  for (let i = 0; i < 8; i++) {
    const pk = await generateKeyPair("secp256k1");
    const peer = peerIdFromPrivateKey(pk);
    peer.toString = () => `peer-${i}`;
    peers.push(peer);
  }
  const none = BitArray.fromBitLen(ATTESTATION_SUBNET_COUNT);
  const status = ssz.phase0.Status.defaultValue();
  const defaultOpts: PrioritizePeersOpts = {
    targetPeers: 1,
    maxPeers: 1,
    targetSubnetPeers: 1,
    status,
    starved: false,
    starvationPruneRatio: 0.05,
    starvationThresholdSlots: SLOTS_PER_EPOCH * 2,
  };

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
      opts: defaultOpts,
      expectedResult: {
        peersToDisconnect: new Map(),
        peersToConnect: 1,
        attnetQueries: [{subnet: 3, maxPeersToDiscover: 1, toSlot: 0}],
        syncnetQueries: [],
      },
    },
    {
      id: "Don't request a subnet query when enough peers are connected to it",
      connectedPeers: [{id: peers[0], direction: null, syncnets: none, attnets: getAttnets([3]), score: 0, status}],
      activeAttnets: [3],
      activeSyncnets: [],
      opts: defaultOpts,
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
        {id: peers[0], direction: null, syncnets: none, attnets: getAttnets([3]), score: 0, status},
        {id: peers[1], direction: null, syncnets: none, attnets: getAttnets([5]), score: -5, status},
        {id: peers[2], direction: null, syncnets: none, attnets: getAttnets([5]), score: -10, status},
        {id: peers[3], direction: null, syncnets: none, attnets: getAttnets([5, 6, 7]), score: -19, status},
      ],
      activeAttnets: [3],
      activeSyncnets: [],
      opts: defaultOpts,
      expectedResult: {
        // Peers sorted by score, excluding with future duties
        peersToDisconnect: new Map<ExcessPeerDisconnectReason, PeerId[]>([
          // peer3 should be the last since it has most subnets
          [ExcessPeerDisconnectReason.LOW_SCORE, [peers[2], peers[1], peers[3]]],
        ]),
        peersToConnect: 0,
        attnetQueries: [],
        syncnetQueries: [],
      },
    },
    {
      id: "Disconnect no long-lived-subnet peers without duty",
      connectedPeers: [
        {id: peers[0], direction: null, syncnets: none, attnets: getAttnets([3]), score: 0, status},
        {id: peers[1], direction: null, syncnets: none, attnets: none, score: -0.1, status},
        {id: peers[2], direction: null, syncnets: none, attnets: none, score: -0.2, status},
        {id: peers[3], direction: null, syncnets: none, attnets: none, score: -0.3, status},
      ],
      activeAttnets: [3],
      activeSyncnets: [],
      opts: defaultOpts,
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
        {id: peers[0], direction: null, syncnets: none, attnets: getAttnets([1, 3]), score: 0, status},
        // below peers are too grouped into subnet 1
        {id: peers[1], direction: null, syncnets: none, attnets: getAttnets([1, 4, 6]), score: 0, status},
        {id: peers[2], direction: null, syncnets: none, attnets: getAttnets([1, 4]), score: 0, status},
        {id: peers[3], direction: null, syncnets: none, attnets: getAttnets([1]), score: 0, status},
        // should not remove this peer due or syncnet peers would drop below min value
        {id: peers[4], direction: null, syncnets: getSyncnets([2, 3]), attnets: getAttnets([1]), score: 0, status},
      ],
      activeAttnets: [3],
      activeSyncnets: [2],
      opts: {...defaultOpts, targetPeers: 2, maxPeers: 2},
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
        {id: peers[0], direction: null, syncnets: none, attnets: getAttnets([1, 3]), score: 0, status},
        // below peers are too grouped into subnet 1
        // but cannot remove them due to syncnet requirement
        {id: peers[1], direction: null, syncnets: getSyncnets([2]), attnets: getAttnets([1, 4, 6]), score: 0, status},
        {id: peers[2], direction: null, syncnets: getSyncnets([2]), attnets: getAttnets([1, 4]), score: 0, status},
        // biggest maxPeerSubnet is 1 (3 peers) but cannot remove all of them
        // 2nd biggest maxPeerSubnet is 7, should remove peers from that subnet
        {id: peers[3], direction: null, syncnets: none, attnets: getAttnets([7]), score: 0, status},
        // peer 4 has more long lived subnets than peer 3, should not remove it
        {id: peers[4], direction: null, syncnets: none, attnets: getAttnets([7, 8]), score: 0, status},
      ],
      activeAttnets: [3],
      activeSyncnets: [2],
      opts: {...defaultOpts, targetPeers: 4, maxPeers: 4},
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
      id: "Ensure to prune to target peers",
      connectedPeers: [
        {id: peers[0], direction: null, syncnets: none, attnets: getAttnets([1, 2, 3]), score: 0, status},
        {id: peers[1], direction: null, syncnets: none, attnets: getAttnets([1, 2]), score: -1.9, status},
        {id: peers[2], direction: null, syncnets: none, attnets: getAttnets([3, 4]), score: -1.8, status},
        {id: peers[3], direction: null, syncnets: none, attnets: getAttnets([4]), score: -1, status},
        {id: peers[4], direction: null, syncnets: none, attnets: getAttnets([5]), score: -1.5, status},
      ],
      activeAttnets: [1, 2, 3],
      activeSyncnets: [],
      opts: {...defaultOpts, targetSubnetPeers: 2},
      expectedResult: {
        peersToDisconnect: new Map<ExcessPeerDisconnectReason, PeerId[]>([
          // the order is based on sortPeers() logic
          [ExcessPeerDisconnectReason.FIND_BETTER_PEERS, [peers[4], peers[3], peers[2], peers[1]]],
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
        {id: peers[0], direction: "inbound", syncnets: none, attnets: getAttnets([0]), score: 0, status},
        {id: peers[1], direction: "inbound", syncnets: none, attnets: getAttnets([1]), score: -10, status},
        {id: peers[2], direction: "inbound", syncnets: none, attnets: getAttnets([2]), score: -20, status},
        {id: peers[3], direction: "inbound", syncnets: none, attnets: getAttnets([3]), score: -30, status},
        {id: peers[4], direction: "outbound", syncnets: none, attnets: getAttnets([4]), score: -40, status},
        {id: peers[5], direction: "outbound", syncnets: none, attnets: getAttnets([5]), score: -50, status},
        {id: peers[6], direction: "outbound", syncnets: none, attnets: getAttnets([6]), score: -60, status},
        {id: peers[7], direction: "outbound", syncnets: none, attnets: getAttnets([7]), score: -70, status},
      ],
      activeAttnets: [],
      activeSyncnets: [],
      opts: {...defaultOpts, targetPeers: 4, maxPeers: 4, outboundPeersRatio: 2 / 8},
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
        {id: peers[0], direction: null, syncnets: none, attnets: getAttnets([0, 1, 2]), score: 0, status},
        {id: peers[1], direction: null, syncnets: none, attnets: getAttnets([0, 1, 2]), score: -10, status},
        {id: peers[2], direction: null, syncnets: none, attnets: getAttnets([0, 1]), score: 0, status},
        {id: peers[3], direction: null, syncnets: none, attnets: getAttnets([0]), score: -10, status},
        {id: peers[4], direction: null, syncnets: none, attnets: getAttnets([2]), score: 0, status},
        {id: peers[5], direction: null, syncnets: none, attnets: getAttnets([0, 2]), score: -20, status},
        {id: peers[6], direction: null, syncnets: none, attnets: getAttnets([1, 2, 3]), score: 0, status},
        {id: peers[7], direction: null, syncnets: none, attnets: getAttnets([1, 2]), score: -10, status},
      ],
      activeAttnets: [1, 3],
      activeSyncnets: [],
      opts: {...defaultOpts, targetPeers: 6, maxPeers: 6, targetSubnetPeers: 2},
      expectedResult: {
        // Peers sorted by score, excluding with future duties
        peersToDisconnect: new Map<ExcessPeerDisconnectReason, PeerId[]>([
          // peer 3 has better score but fewer long lived subnets
          [ExcessPeerDisconnectReason.LOW_SCORE, [peers[3], peers[5]]],
        ]),
        peersToConnect: 0,
        attnetQueries: [{subnet: 3, maxPeersToDiscover: 1, toSlot: 0}],
        syncnetQueries: [],
      },
    },
    {
      id: "Disconnect close to us peers before far ahead peers when starved",
      connectedPeers: [
        // CLOSE_TO_US peers
        {id: peers[0], direction: null, syncnets: none, attnets: none, score: 0, status: null},
        {id: peers[1], direction: null, syncnets: none, attnets: none, score: -1, status: null},
        // FAR_AHEAD peer
        {
          id: peers[2],
          direction: null,
          syncnets: none,
          attnets: none,
          score: -2,
          status: {...status, headSlot: defaultOpts.starvationThresholdSlots + 1},
        },
      ],
      activeAttnets: [],
      activeSyncnets: [],
      opts: {
        ...defaultOpts,
        targetPeers: 2,
        starved: true,
        // prune one more peer due to being starved
        starvationPruneRatio: 0.5,
      },
      expectedResult: {
        peersToConnect: 0,
        attnetQueries: [],
        syncnetQueries: [],
        peersToDisconnect: new Map<ExcessPeerDisconnectReason, PeerId[]>([
          // only the two CLOSE_TO_US peers are disconnected; keep FAR_AHEAD peer
          [ExcessPeerDisconnectReason.NO_LONG_LIVED_SUBNET, [peers[1], peers[0]]],
        ]),
      },
    },

    // TODO: Add a test case with syncnets priorization
  ];

  for (const {id, connectedPeers, activeAttnets, activeSyncnets, opts, expectedResult} of testCases) {
    it(id, () => {
      const result = prioritizePeers(connectedPeers, toReqSubnet(activeAttnets), toReqSubnet(activeSyncnets), opts);
      expect(cleanResult(result)).toEqual(cleanResult(expectedResult));
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

describe("sortPeersToPrune", async () => {
  const peers: PeerId[] = [];
  for (let i = 0; i < 8; i++) {
    const pk = await generateKeyPair("secp256k1");
    const peer = peerIdFromPrivateKey(pk);
    peer.toString = () => `peer-${i}`;
    peers.push(peer);
  }
  const none = BitArray.fromBitLen(ATTESTATION_SUBNET_COUNT);

  it("should sort peers by dutied subnets then long lived subnets then score", () => {
    const connectedPeers = [
      {id: peers[3], direction: null, syncnets: none, attnets: getAttnets([0, 4]), score: -1, statusScore: -1},
      {id: peers[2], direction: null, syncnets: none, attnets: getAttnets([2, 3, 5]), score: 0, statusScore: -1},
      {id: peers[1], direction: null, syncnets: none, attnets: getAttnets([3, 5]), score: -1, statusScore: -1},
      {id: peers[0], direction: null, syncnets: none, attnets: getAttnets([6, 7]), score: -1.9, statusScore: -1},
    ].map((p) => ({
      ...p,
      attnetsTrueBitIndices: p.attnets?.getTrueBitIndexes() ?? [],
      syncnetsTrueBitIndices: p.syncnets?.getTrueBitIndexes() ?? [],
    }));

    const dutiesByPeer = new Map<(typeof connectedPeers)[0], number>([
      [connectedPeers[0], 2],
      [connectedPeers[1], 0],
      [connectedPeers[2], 0],
      [connectedPeers[3], 0],
    ]);

    expect(sortPeersToPrune(connectedPeers, dutiesByPeer).map((p) => p.id.toString())).toEqual([
      // peer-0 is the worse and has the most chance to prune
      "peer-0",
      // peer-1 is better than peer-0 in terms of score
      "peer-1",
      // peer-2 has the most long lived subnets between 0/1/2
      "peer-2",
      // peer-3 has the most dutied subnets
      "peer-3",
    ]);
  });
});
