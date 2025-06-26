import {createChainForkConfig} from "@lodestar/config";
import {chainConfig} from "@lodestar/config/default";
import {ZERO_HASH} from "@lodestar/params";
import {computeStartSlotAtEpoch} from "@lodestar/state-transition";
import {describe, expect, it} from "vitest";
import {Batch} from "../../../../../src/sync/range/batch.js";
import {ChainTarget} from "../../../../../src/sync/range/chain.js";
import {ChainPeersBalancer, PeerSyncInfo} from "../../../../../src/sync/range/utils/peerBalancer.js";
import {CustodyConfig} from "../../../../../src/util/dataColumns.js";
import {PeerIdStr} from "../../../../../src/util/peerId.js";
import {getRandPeerSyncMeta} from "../../../../utils/peer.js";

describe("sync / range / peerBalancer", () => {
  const custodyConfig = {sampledColumns: [0, 1, 2, 3]} as CustodyConfig;

  describe("bestPeerToRetryBatch", async () => {
    const peer1 = await getRandPeerSyncMeta("peer-1");
    const peer2 = await getRandPeerSyncMeta("peer-2");
    const peer3 = await getRandPeerSyncMeta("peer-3");
    const peer4 = await getRandPeerSyncMeta("peer-4");
    const peers = [peer1, peer2, peer3, peer4];

    const testCases: {
      isFulu: boolean;
      custodyColumns: number[][];
      targetEpochs: number[];
      earliestAvailableSlots: (number | undefined | null)[];
      expected: PeerIdStr;
    }[] = [
      {
        isFulu: true,
        // peer3 and peer 4 are free and has some/all custody columns and has the greater target epoch
        // pick peer4 because it has more custody columns
        // test column sort condition
        custodyColumns: [[], [0, 1], [0, 1, 2, 3]],
        targetEpochs: [1, 2, 3, 4],
        earliestAvailableSlots: [0, 0, 0, 0],
        expected: peer3.peerId,
      },
      {
        isFulu: true,
        // peer3 is free and has partial custody columns (0) and has the greater target epoch
        // peer 4 has unrelated custody column
        // test target epoch condition
        custodyColumns: [[], [0, 1, 2, 3], [0], [100]],
        targetEpochs: [1, 2, 3, 4],
        earliestAvailableSlots: [0, 0, 0, 0],
        expected: peer3.peerId,
      },
      {
        isFulu: true,
        // peer3 is free and has full custody columns, but don't have greater target epoch
        // peer 4 has unrelated custody column
        // test target epoch condition
        custodyColumns: [[], [0, 1, 2, 3], [0, 1, 2, 3], [100]],
        targetEpochs: [1, 2, 0, 4],
        earliestAvailableSlots: [0, 0, 0, 0],
        expected: peer2.peerId,
      },
      {
        isFulu: true,
        // peer3 is free but don't have any custody columns
        // peer 4 has unrelated custody column
        // test custody columns condition
        custodyColumns: [[], [0, 1, 2, 3], [4, 5, 6, 7], [100]],
        targetEpochs: [1, 2, 3, 4],
        earliestAvailableSlots: [0, 0, 0, 0],
        expected: peer2.peerId,
      },
      {
        isFulu: true,
        // peer3 and peer4 are free but peer4 has more clumns
        // test custody columns condition
        custodyColumns: [[], [0, 1, 2, 3], [2, 3, 4, 5], [1, 2, 3, 4]],
        targetEpochs: [1, 2, 3, 4],
        earliestAvailableSlots: [0, 0, 0, 0],
        expected: peer4.peerId,
      },
      {
        isFulu: true,
        // peer3 is free and has all columns but pick peer4 because it has earliestAvailableSlot
        // test earliestAvailableSlots condition
        custodyColumns: [[], [0, 1, 2, 3], [0, 1, 2, 3], [0]],
        targetEpochs: [1, 2, 3, 4],
        earliestAvailableSlots: [0, 0, undefined, 0],
        expected: peer4.peerId,
      },
      {
        isFulu: false,
        // pre-fulu, same to the the above, pick peer3 because has good target epoch
        // test pre-fulu condition
        custodyColumns: [[], [0, 1, 2, 3], [4, 5, 6, 7], [100]],
        targetEpochs: [1, 2, 3, 0],
        earliestAvailableSlots: [null, null, null, null],
        expected: peer3.peerId,
      },
    ];
    for (const [i, {isFulu, custodyColumns, targetEpochs, earliestAvailableSlots, expected}] of testCases.entries()) {
      it(`test case ${i}`, async () => {
        const columnsByPeer = new Map<PeerIdStr, {custodyColumns: number[]}>();
        for (const [i, custody] of custodyColumns.entries()) {
          columnsByPeer.set(peers[i].peerId, {custodyColumns: custody});
        }

        const targetByPeer = new Map<PeerIdStr, ChainTarget>();
        for (const [i, targetEpoch] of targetEpochs.entries()) {
          targetByPeer.set(peers[i].peerId, {slot: computeStartSlotAtEpoch(targetEpoch), root: ZERO_HASH});
        }

        const earliestAvailableSlotByPeers = new Map<PeerIdStr, number | undefined | null>();
        for (const [i, earliestAvailableSlot] of earliestAvailableSlots.entries()) {
          earliestAvailableSlotByPeers.set(peers[i].peerId, earliestAvailableSlot);
        }

        const peerInfos: PeerSyncInfo[] = peers.map((p) => ({
          ...p,
          custodyGroups: columnsByPeer.get(p.peerId)?.custodyColumns ?? [],
          target: targetByPeer.get(p.peerId) ?? ({slot: 0, root: ZERO_HASH} as ChainTarget),
          earliestAvailableSlot: earliestAvailableSlotByPeers.get(p.peerId) ?? undefined,
        }));

        const config = isFulu
          ? createChainForkConfig({...chainConfig, FULU_FORK_EPOCH: 0})
          : createChainForkConfig(chainConfig);

        const batch0 = new Batch(1, config);
        const batch1 = new Batch(2, config);

        // Batch zero has a failedDownloadAttempt with peer1
        batch0.startDownloading(peer1.peerId);
        batch0.downloadingError();

        // peer2 is busy downloading batch1
        batch1.startDownloading(peer2.peerId);

        const peerBalancer = new ChainPeersBalancer(peerInfos, [batch0, batch1], custodyConfig);
        expect(peerBalancer.bestPeerToRetryBatch(batch0)?.peerId).toBe(expected);
      });
    }
  });

  describe("idlePeerForBatch", async () => {
    const peer1 = await getRandPeerSyncMeta("peer-1");
    const peer2 = await getRandPeerSyncMeta("peer-2");
    const peer3 = await getRandPeerSyncMeta("peer-3");
    const peer4 = await getRandPeerSyncMeta("peer-4");
    const peers = [peer1, peer2, peer3, peer4];

    const testCases: {
      isFulu: boolean;
      custodyColumns: number[][];
      targetEpochs: number[];
      earliestAvailableSlots: (number | undefined | null)[];
      expected: string | undefined;
    }[] = [
      {
        isFulu: true,
        // peer3 and peer4 are free and have greater target epoch, pick peer3 because it has more custody columns
        custodyColumns: [[], [], [0, 1, 2, 3], [0]],
        targetEpochs: [1, 2, 4, 4],
        earliestAvailableSlots: [0, 0, 0, 0],
        expected: peer3.peerId,
      },
      {
        isFulu: true,
        // peer3 and peer4 are free and have greater target epoch, pick peer4 because it available slots
        custodyColumns: [[], [], [0, 1, 2, 3], [0]],
        targetEpochs: [1, 2, 4, 4],
        earliestAvailableSlots: [0, 0, undefined, 0],
        expected: peer4.peerId,
      },
      {
        isFulu: true,
        // peer3 and peer4 are free, peer3 does not have greater epoch, peer4 has full custody columns, pick peer4
        custodyColumns: [[], [], [0, 1, 2, 3], [0, 1, 2, 3]],
        targetEpochs: [1, 2, 2, 4],
        earliestAvailableSlots: [0, 0, 0, 0],
        expected: peer4.peerId,
      },
      {
        isFulu: true,
        // peer3 and peer4 are free, peer3 does not have greater epoch, peer4 has partial custody columns, pick peer4
        custodyColumns: [[], [], [0, 1, 2, 3], [3]],
        targetEpochs: [1, 2, 2, 4],
        earliestAvailableSlots: [0, 0, 0, 0],
        expected: peer4.peerId,
      },
      {
        isFulu: true,
        // peer3 and peer4 are free, peer3 does not have greater epoch, peer4 does not have custody columns we need, pick nothing
        custodyColumns: [[], [], [0, 1, 2, 3], []],
        targetEpochs: [1, 2, 2, 4],
        earliestAvailableSlots: [0, 0, 0, 0],
        expected: undefined,
      },
      {
        isFulu: false,
        // pre-fulu, same to the above, pick peer4 because we don't care about custody columns
        custodyColumns: [[], [], [0, 1, 2, 3], []],
        targetEpochs: [1, 2, 2, 4],
        earliestAvailableSlots: [undefined, undefined, undefined, undefined],
        expected: peer4.peerId,
      },
    ];

    for (const [i, {isFulu, custodyColumns, targetEpochs, earliestAvailableSlots, expected}] of testCases.entries()) {
      it(`test case ${i}`, async () => {
        const columnsByPeer = new Map<PeerIdStr, {custodyColumns: number[]}>();
        for (const [i, custody] of custodyColumns.entries()) {
          columnsByPeer.set(peers[i].peerId, {custodyColumns: custody});
        }

        const targetByPeer = new Map<PeerIdStr, ChainTarget>();
        for (const [i, targetEpoch] of targetEpochs.entries()) {
          targetByPeer.set(peers[i].peerId, {slot: computeStartSlotAtEpoch(targetEpoch), root: ZERO_HASH});
        }

        const earliestAvailableSlotByPeers = new Map<PeerIdStr, number | undefined | null>();
        for (const [i, earliestAvailableSlot] of earliestAvailableSlots.entries()) {
          earliestAvailableSlotByPeers.set(peers[i].peerId, earliestAvailableSlot);
        }

        const peerInfos: PeerSyncInfo[] = peers.map((p) => ({
          ...p,
          custodyGroups: columnsByPeer.get(p.peerId)?.custodyColumns ?? [],
          target: targetByPeer.get(p.peerId) ?? {slot: 0, root: ZERO_HASH},
          earliestAvailableSlot: earliestAvailableSlotByPeers.get(p.peerId) ?? undefined,
        }));

        const config = isFulu
          ? createChainForkConfig({...chainConfig, FULU_FORK_EPOCH: 0})
          : createChainForkConfig(chainConfig);

        const batch0 = new Batch(1, config);
        const batch1 = new Batch(2, config);
        // peer1 and peer2 are busy downloading
        batch0.startDownloading(peer1.peerId);
        batch1.startDownloading(peer2.peerId);

        const newBatch = new Batch(3, config);
        const peerBalancer = new ChainPeersBalancer(peerInfos, [batch0, batch1], custodyConfig);
        const idlePeer = peerBalancer.idlePeerForBatch(newBatch);
        expect(idlePeer?.peerId).toBe(expected);
      });
    }
  });
});
