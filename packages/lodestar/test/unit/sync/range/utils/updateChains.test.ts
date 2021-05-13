import {expect} from "chai";
import {updateChains} from "../../../../../src/sync/range/utils/updateChains";
import {SyncChain} from "../../../../../src/sync/range/chain";
import {RangeSyncType} from "../../../../../src/sync/utils/remoteSyncType";

describe("sync / range / utils / updateChains", () => {
  const testCases: {
    id: string;
    chains: MockSyncChain[];
    expectedRes: {toStart: MockSyncChainId[]; toStop: MockSyncChainId[]};
  }[] = [
    {
      id: "Prioritize new finalized chain with more peers",
      chains: [
        {logId: "0", peers: 10, isSyncing: true, validatedEpochs: 15, syncType: RangeSyncType.Finalized},
        {logId: "1", peers: 12, isSyncing: false, validatedEpochs: 0, syncType: RangeSyncType.Finalized},
      ],
      expectedRes: {toStart: ["1"], toStop: ["0"]},
    },
    {
      id: "Keep syncing current SyncChain, has more peers",
      chains: [
        {logId: "0", peers: 12, isSyncing: true, validatedEpochs: 15, syncType: RangeSyncType.Finalized},
        {logId: "1", peers: 10, isSyncing: false, validatedEpochs: 0, syncType: RangeSyncType.Finalized},
      ],
      expectedRes: {toStart: [], toStop: []},
    },
    {
      id: "Keep syncing current SyncChain, has not synced enough",
      chains: [
        {logId: "0", peers: 10, isSyncing: true, validatedEpochs: 2, syncType: RangeSyncType.Finalized},
        {logId: "1", peers: 12, isSyncing: false, validatedEpochs: 0, syncType: RangeSyncType.Finalized},
      ],
      expectedRes: {toStart: [], toStop: []},
    },
    {
      id: "Prioritize head chains with more peers",
      chains: [
        {logId: "0", peers: 12, isSyncing: true, validatedEpochs: 0, syncType: RangeSyncType.Head},
        {logId: "1", peers: 8, isSyncing: false, validatedEpochs: 0, syncType: RangeSyncType.Head},
        {logId: "2", peers: 10, isSyncing: true, validatedEpochs: 0, syncType: RangeSyncType.Head},
        {logId: "3", peers: 10, isSyncing: false, validatedEpochs: 0, syncType: RangeSyncType.Head},
      ],
      expectedRes: {toStart: ["0", "2"], toStop: ["3", "1"]},
    },
  ];

  for (const {id, chains, expectedRes} of testCases) {
    it(id, () => {
      const res = updateChains(chains.map(fromMockSyncChain));
      expect({
        toStart: res.toStart.map(toId),
        toStop: res.toStop.map(toId),
      }).to.deep.equal(expectedRes);
    });
  }

  type MockSyncChainId = string;

  type MockSyncChain = {
    logId: MockSyncChainId;
    peers: number;
    isSyncing: boolean;
    validatedEpochs: number;
    syncType: RangeSyncType;
  };

  function fromMockSyncChain(chain: MockSyncChain): SyncChain {
    return chain as SyncChain;
  }

  function toId(chain: SyncChain): MockSyncChainId {
    return chain.logId;
  }
});
