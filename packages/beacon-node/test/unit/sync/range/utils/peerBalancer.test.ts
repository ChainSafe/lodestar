import {describe, expect, it} from "vitest";
import {createChainForkConfig} from "@lodestar/config";
import {chainConfig} from "@lodestar/config/default";
import {ForkName, ZERO_HASH} from "@lodestar/params";
import {computeStartSlotAtEpoch} from "@lodestar/state-transition";
import {SignedBeaconBlock, ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {BlockInputColumns, BlockInputNoData} from "../../../../../src/chain/blocks/blockInput/blockInput.js";
import {BlockInputSource} from "../../../../../src/chain/blocks/blockInput/types.js";
import {Batch, BatchStatus} from "../../../../../src/sync/range/batch.js";
import {ChainTarget} from "../../../../../src/sync/range/chain.js";
import {ChainPeersBalancer, PeerSyncInfo} from "../../../../../src/sync/range/utils/peerBalancer.js";
import {RangeSyncType} from "../../../../../src/sync/utils/remoteSyncType.js";
import {CustodyConfig} from "../../../../../src/util/dataColumns.js";
import {PeerIdStr} from "../../../../../src/util/peerId.js";
import {clock} from "../../../../utils/blocksAndData.js";
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
      maxConcurrentRequests?: number;
      expected?: PeerIdStr;
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
        // same to above but it should not return any peers
        // peer3 is free but don't have any custody columns
        // peer 4 has unrelated custody column
        // peer 2 is busy downloading batch1 and maxConcurrentRequests is 1
        // test custody columns condition and maxConcurrentRequests condition
        custodyColumns: [[], [0, 1, 2, 3], [4, 5, 6, 7], [100]],
        targetEpochs: [1, 2, 3, 4],
        earliestAvailableSlots: [0, 0, 0, 0],
        maxConcurrentRequests: 1,
        expected: undefined,
      },
      {
        isFulu: true,
        // peer3 and peer4 are free but peer4 has more columns
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
    for (const [
      i,
      {isFulu, custodyColumns, targetEpochs, earliestAvailableSlots, maxConcurrentRequests, expected},
    ] of testCases.entries()) {
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
          custodyColumns: columnsByPeer.get(p.peerId)?.custodyColumns ?? [],
          target: targetByPeer.get(p.peerId) ?? ({slot: 0, root: ZERO_HASH} as ChainTarget),
          earliestAvailableSlot: earliestAvailableSlotByPeers.get(p.peerId) ?? undefined,
        }));

        const config = isFulu
          ? createChainForkConfig({...chainConfig, FULU_FORK_EPOCH: 0})
          : createChainForkConfig(chainConfig);

        const batch0 = new Batch(1, config, clock, custodyConfig, false, undefined, Number.MAX_SAFE_INTEGER);
        const batch1 = new Batch(2, config, clock, custodyConfig, false, undefined, Number.MAX_SAFE_INTEGER);

        // Batch zero has a failedDownloadAttempt with peer1
        batch0.startDownloading(peer1);
        batch0.downloadingError(peer1.peerId);

        // peer2 is busy downloading batch1
        batch1.startDownloading(peer2);

        const peerBalancer = new ChainPeersBalancer(
          peerInfos,
          [batch0, batch1],
          custodyConfig,
          RangeSyncType.Head,
          maxConcurrentRequests
        );
        expect(peerBalancer.bestPeerToRetryBatch(batch0)?.peerId).toBe(expected);
      });
    }

    it("should not retry with a peer that already returned a (partial) success for this batch (#9357)", async () => {
      const config = createChainForkConfig({...chainConfig, FULU_FORK_EPOCH: 0});
      const batch0 = new Batch(1, config, clock, custodyConfig, false, undefined, Number.MAX_SAFE_INTEGER);
      const blocksRequest = batch0.requests.blocksRequest as {startSlot: number; count: number};
      const peer1WithColumns = {...peer1, custodyColumns: [0, 1, 2, 3]};

      // peer1 returns a partial success — block but no envelope/columns required for completion.
      batch0.startDownloading(peer1WithColumns);
      const block = ssz.fulu.SignedBeaconBlock.defaultValue();
      block.message.slot = blocksRequest.startSlot + blocksRequest.count - 1;
      block.message.body.blobKzgCommitments = [ssz.fulu.KZGCommitment.defaultValue()];
      const blockInput = BlockInputColumns.createFromBlock({
        block,
        blockRootHex: "0x00",
        source: BlockInputSource.gossip,
        seenTimestampSec: Math.floor(Date.now() / 1000),
        forkName: config.getForkName(block.message.slot),
        daOutOfRange: false,
        custodyColumns: [0, 1, 2, 3],
        sampledColumns: [0, 1, 2, 3],
      });
      batch0.downloadingSuccess(peer1.peerId, [blockInput], null);
      // Partial download (only 1 block of `count`) — batch must be back in AwaitingDownload.
      expect(batch0.state.status).toBe("AwaitingDownload");
      expect(batch0.getFailedPeers()).not.toContain(peer1.peerId);

      const peerInfos: PeerSyncInfo[] = [peer1, peer2].map((p) => ({
        ...p,
        custodyColumns: [0, 1, 2, 3],
        target: {slot: blocksRequest.startSlot + blocksRequest.count - 1, root: ZERO_HASH},
        earliestAvailableSlot: 0,
      }));

      const peerBalancer = new ChainPeersBalancer(peerInfos, [batch0], custodyConfig, RangeSyncType.Head);

      // peer1 succeeded — must be excluded; peer2 is the only eligible peer.
      expect(peerBalancer.bestPeerToRetryBatch(batch0)?.peerId).toBe(peer2.peerId);
    });

    it("should not retry a peer when its previous by_range columns cover the current request", async () => {
      const config = createChainForkConfig({...chainConfig, FULU_FORK_EPOCH: 0});
      const subsetCustodyConfig = {sampledColumns: [3, 5, 7]} as CustodyConfig;
      const batch0 = new Batch(1, config, clock, subsetCustodyConfig, false, undefined, Number.MAX_SAFE_INTEGER);
      const blocksRequest = batch0.requests.blocksRequest as {startSlot: number; count: number};
      const peer1WithColumns = {...peer1, custodyColumns: [3, 5, 7]};

      batch0.startDownloading(peer1WithColumns);
      const block = ssz.fulu.SignedBeaconBlock.defaultValue();
      block.message.slot = blocksRequest.startSlot + blocksRequest.count - 1;
      block.message.body.blobKzgCommitments = [ssz.fulu.KZGCommitment.defaultValue()];
      const blockInput = BlockInputColumns.createFromBlock({
        block,
        blockRootHex: "0x00",
        source: BlockInputSource.gossip,
        seenTimestampSec: Math.floor(Date.now() / 1000),
        forkName: config.getForkName(block.message.slot),
        daOutOfRange: false,
        custodyColumns: [3, 5, 7],
        sampledColumns: [3, 5, 7],
      });
      batch0.downloadingSuccess(peer1.peerId, [blockInput], null);

      const columnsRequest = batch0.requests.columnsRequest;
      expect(columnsRequest).toBeDefined();
      if (columnsRequest == null) throw Error("Expected columns request");
      batch0.requests.columnsRequest = {...columnsRequest, columns: [3, 5]};

      const peerInfos: PeerSyncInfo[] = [peer1, peer2].map((p) => ({
        ...p,
        custodyColumns: [3, 5],
        target: {slot: blocksRequest.startSlot + blocksRequest.count - 1, root: ZERO_HASH},
        earliestAvailableSlot: 0,
      }));

      const peerBalancer = new ChainPeersBalancer(peerInfos, [batch0], subsetCustodyConfig, RangeSyncType.Head);

      expect(peerBalancer.bestPeerToRetryBatch(batch0)?.peerId).toBe(peer2.peerId);
    });

    it("should not retry a peer when by_range narrows to an envelope-only request (#9357)", async () => {
      const config = createChainForkConfig({...chainConfig, FULU_FORK_EPOCH: 0, GLOAS_FORK_EPOCH: 0});
      const batch0 = new Batch(1, config, clock, custodyConfig, false, undefined, Number.MAX_SAFE_INTEGER);
      const blocksRequest = batch0.requests.blocksRequest as {startSlot: number; count: number};
      const peer1WithColumns = {...peer1, custodyColumns: [0, 1, 2, 3]};

      batch0.startDownloading(peer1WithColumns);
      const block = ssz.gloas.SignedBeaconBlock.defaultValue();
      block.message.slot = blocksRequest.startSlot + blocksRequest.count - 1;
      block.message.body.signedExecutionPayloadBid.message.blobKzgCommitments = [
        ssz.gloas.KZGCommitment.defaultValue(),
      ];
      const blockInput = BlockInputNoData.createFromBlock({
        block: block as SignedBeaconBlock<typeof ForkName.gloas>,
        blockRootHex: "0x00",
        source: BlockInputSource.gossip,
        seenTimestampSec: Math.floor(Date.now() / 1000),
        forkName: ForkName.gloas,
        daOutOfRange: false,
        peerIdStr: peer1.peerId,
      });
      batch0.downloadingSuccess(peer1.peerId, [blockInput], null);
      batch0.state = {status: BatchStatus.AwaitingDownload, blocks: [blockInput], payloadEnvelopes: null};
      batch0.requests = {
        envelopesRequest: {startSlot: blocksRequest.startSlot, count: blocksRequest.count},
      };

      const peerInfos: PeerSyncInfo[] = [peer1, peer2].map((p) => ({
        ...p,
        custodyColumns: [0, 1, 2, 3],
        target: {slot: blocksRequest.startSlot + blocksRequest.count - 1, root: ZERO_HASH},
        earliestAvailableSlot: 0,
      }));

      const peerBalancer = new ChainPeersBalancer(peerInfos, [batch0], custodyConfig, RangeSyncType.Head);

      expect(peerBalancer.bestPeerToRetryBatch(batch0)?.peerId).toBe(peer2.peerId);
    });

    it("should retry a successful peer when the batch request changes to parent payload", async () => {
      const config = createChainForkConfig({...chainConfig, FULU_FORK_EPOCH: 0, GLOAS_FORK_EPOCH: 0});
      const latestBid = ssz.gloas.ExecutionPayloadBid.defaultValue();
      latestBid.blockHash = Buffer.alloc(32, 0x22);
      latestBid.blobKzgCommitments = [ssz.gloas.KZGCommitment.defaultValue()];
      const batch0 = new Batch(1, config, clock, custodyConfig, true, latestBid, Number.MAX_SAFE_INTEGER);
      const blocksRequest = batch0.requests.blocksRequest as {startSlot: number; count: number};

      batch0.startDownloading(peer1);
      const block = ssz.gloas.SignedBeaconBlock.defaultValue();
      block.message.slot = blocksRequest.startSlot;
      block.message.parentRoot = Buffer.alloc(32, 0x11);
      block.message.body.signedExecutionPayloadBid.message.parentBlockHash = latestBid.blockHash;
      const blockRootHex = toRootHex(ssz.gloas.BeaconBlock.hashTreeRoot(block.message));
      const blockInput = BlockInputNoData.createFromBlock({
        block: block as SignedBeaconBlock<typeof ForkName.gloas>,
        blockRootHex,
        source: BlockInputSource.gossip,
        seenTimestampSec: Math.floor(Date.now() / 1000),
        forkName: ForkName.gloas,
        daOutOfRange: false,
        peerIdStr: peer1.peerId,
      });
      batch0.downloadingSuccess(peer1.peerId, [blockInput], null);
      expect(batch0.state.status).toBe("AwaitingDownload");
      expect(batch0.requests.parentPayloadRequest).toBeDefined();

      const peerInfos: PeerSyncInfo[] = [
        {
          ...peer1,
          custodyColumns: [0, 1, 2, 3],
          target: {slot: blocksRequest.startSlot + blocksRequest.count - 1, root: ZERO_HASH},
          earliestAvailableSlot: 0,
        },
      ];

      const peerBalancer = new ChainPeersBalancer(peerInfos, [batch0], custodyConfig, RangeSyncType.Head);

      expect(peerBalancer.bestPeerToRetryBatch(batch0)?.peerId).toBe(peer1.peerId);
    });

    it("should not retry the batch with a not as up-to-date peer", async () => {
      const config = createChainForkConfig({...chainConfig, FULU_FORK_EPOCH: 0});
      const batch0 = new Batch(1, config, clock, custodyConfig, false, undefined, Number.MAX_SAFE_INTEGER);
      const blocksRequest = batch0.requests.blocksRequest as {startSlot: number; count: number};
      const peer1WithColumns = {...peer1, custodyColumns: [0, 1, 2, 3]};
      // Batch zero has a failedDownloadAttempt with peer1
      batch0.startDownloading(peer1WithColumns);
      const block = ssz.fulu.SignedBeaconBlock.defaultValue();
      block.message.slot = blocksRequest.startSlot + blocksRequest.count - 1;
      block.message.body.blobKzgCommitments = [ssz.fulu.KZGCommitment.defaultValue()];
      const blockInput = BlockInputColumns.createFromBlock({
        block,
        blockRootHex: "0x00",
        source: BlockInputSource.gossip,
        seenTimestampSec: Math.floor(Date.now() / 1000),
        forkName: config.getForkName(block.message.slot),
        daOutOfRange: false,
        custodyColumns: [0, 1, 2, 3],
        sampledColumns: [0, 1, 2, 3],
      });
      batch0.downloadingSuccess(peer1.peerId, [blockInput], null);

      // peer2 and peer3 are the same but peer3 has a lower target slot than the previous download
      const peerInfos: PeerSyncInfo[] = [
        {
          peerId: peer2.peerId,
          client: peer2.client,
          custodyColumns: [0, 1, 2, 3],
          target: {slot: blocksRequest.startSlot + blocksRequest.count - 1, root: ZERO_HASH},
          earliestAvailableSlot: 0,
        },
        {
          peerId: peer3.peerId,
          client: peer3.client,
          custodyColumns: [0, 1, 2, 3],
          target: {slot: blocksRequest.startSlot + blocksRequest.count - 2, root: ZERO_HASH},
          earliestAvailableSlot: 0,
        },
      ];

      const peerBalancer = new ChainPeersBalancer(peerInfos, [batch0], custodyConfig, RangeSyncType.Head);

      expect(peerBalancer.bestPeerToRetryBatch(batch0)?.peerId).toBe(peer2.peerId);
    });
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
          custodyColumns: columnsByPeer.get(p.peerId)?.custodyColumns ?? [],
          target: targetByPeer.get(p.peerId) ?? {slot: 0, root: ZERO_HASH},
          earliestAvailableSlot: earliestAvailableSlotByPeers.get(p.peerId) ?? undefined,
        }));

        const config = isFulu
          ? createChainForkConfig({...chainConfig, FULU_FORK_EPOCH: 0})
          : createChainForkConfig(chainConfig);

        const batch0 = new Batch(1, config, clock, custodyConfig, false, undefined, Number.MAX_SAFE_INTEGER);
        const batch1 = new Batch(2, config, clock, custodyConfig, false, undefined, Number.MAX_SAFE_INTEGER);
        // peer1 and peer2 are busy downloading
        batch0.startDownloading(peer1);
        batch1.startDownloading(peer2);

        const newBatch = new Batch(3, config, clock, custodyConfig, false, undefined, Number.MAX_SAFE_INTEGER);
        const peerBalancer = new ChainPeersBalancer(peerInfos, [batch0, batch1], custodyConfig, RangeSyncType.Head);
        const idlePeer = peerBalancer.idlePeerForBatch(newBatch);
        expect(idlePeer?.peerId).toBe(expected);
      });
    }
  });
});
