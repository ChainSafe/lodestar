import {routes} from "@lodestar/api";
import {ChainForkConfig} from "@lodestar/config";
import {RequestError, RequestErrorCode} from "@lodestar/reqresp";
import {computeEpochAtSlot} from "@lodestar/state-transition";
import {Epoch, RootHex, Slot, Status} from "@lodestar/types";
import {toHex} from "@lodestar/utils";
import {fromHex} from "@lodestar/utils";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {ChainEvent, IBeaconChain} from "../../../../src/chain/index.js";
import {Network, NetworkEvent, PeerAction} from "../../../../src/network/index.js";
import {
  BackwardsChain,
  ChainState,
  DownloadState,
  Header,
  LinkedBackwardsChain,
  UnknownAncestorBackwardsChain,
  UnknownHeadBackwardsChain,
} from "../../../../src/sync/unknownChain/backwardsChain.js";
import {UnknownChainSyncMetrics} from "../../../../src/sync/unknownChain/metrics.js";
import {UnknownChainSync, UnknownChainSyncInit} from "../../../../src/sync/unknownChain/unknownChain.js";

describe("sync / unknownChain / unknownChain", () => {
  // Mock dependencies
  let mockConfig: ChainForkConfig;
  let mockChain: IBeaconChain;
  let mockNetwork: Network;
  let mockProcessLinkedChain: vi.MockedFunction<(chain: LinkedBackwardsChain) => void>;
  let mockMetrics: UnknownChainSyncMetrics;
  let unknownChainSync: UnknownChainSync;

  // Test data helpers
  const createHeader = (slot: number, root: string, parentRoot: string): Header => ({
    slot,
    root: root as RootHex,
    parentRoot: parentRoot as RootHex,
  });

  const createStatus = (
    headRoot: string,
    finalizedRoot = "0x0000000000000000000000000000000000000000000000000000000000000000"
  ): Status => ({
    forkDigest: new Uint8Array(4),
    finalizedRoot: fromHex(finalizedRoot),
    finalizedEpoch: 0,
    headRoot: fromHex(headRoot),
    headSlot: 100,
  });

  const createUnknownHeadChain = (headRoot: string): UnknownHeadBackwardsChain => ({
    state: ChainState.UnknownHead,
    downloadState: DownloadState.Idle,
    headRoot: headRoot as RootHex,
    ancestors: new Map(),
    peers: new Set(["peer1"]),
    lastUpdate: Date.now(),
  });

  const createUnknownAncestorChain = (
    headRoot: string,
    head: Header,
    earliestKnownAncestor: string
  ): UnknownAncestorBackwardsChain => ({
    state: ChainState.UnknownAncestor,
    downloadState: DownloadState.Idle,
    headRoot: headRoot as RootHex,
    head,
    earliestKnownAncestor: earliestKnownAncestor as RootHex,
    ancestors: new Map(),
    peers: new Set(["peer1"]),
    lastUpdate: Date.now(),
  });

  const createLinkedChain = (headRoot: string, head: Header, forwardChain: Header[]): LinkedBackwardsChain => ({
    state: ChainState.Linked,
    downloadState: DownloadState.Idle,
    headRoot: headRoot as RootHex,
    head,
    forwardChain,
    ancestors: new Map(),
    peers: new Set(["peer1"]),
    lastUpdate: Date.now(),
  });

  beforeEach(() => {
    // Mock config
    mockConfig = {
      getForkTypes: vi.fn().mockReturnValue({
        BeaconBlock: {
          hashTreeRoot: vi.fn().mockReturnValue(fromHex("0x00")),
        },
      }),
    } as any;

    // Mock chain
    mockChain = {
      forkChoice: {
        hasBlockHex: vi.fn().mockReturnValue(false),
      },
      emitter: {
        on: vi.fn(),
        off: vi.fn(),
      },
    } as any;

    // Mock network
    mockNetwork = {
      events: {
        on: vi.fn(),
        off: vi.fn(),
      },
      sendBeaconBlocksByRoot: vi.fn(),
      reportPeer: vi.fn(),
    } as any;

    // Mock process linked chain function
    mockProcessLinkedChain = vi.fn();

    // Mock metrics
    mockMetrics = {
      processorQueue: undefined,
      headerCount: {
        addCollect: vi.fn(),
        set: vi.fn(),
      },
      chainCount: {
        set: vi.fn(),
      },
      chainHeaders: {
        observe: vi.fn(),
      },
      chainPeers: {
        observe: vi.fn(),
      },
    } as any;

    const init: UnknownChainSyncInit = {
      config: mockConfig,
      chain: mockChain,
      network: mockNetwork,
      processLinkedChain: mockProcessLinkedChain,
      metrics: mockMetrics,
    };

    unknownChainSync = new UnknownChainSync(init);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("onProcessedBlock", () => {
    it("should prune entire chain when block is chain head", () => {
      const chain = createUnknownHeadChain("0x1234");
      unknownChainSync.backwardsChains.set("0x1234", chain);

      unknownChainSync.onProcessedBlock({slot: 100, block: "0x1234"});

      expect(unknownChainSync.backwardsChains.has("0x1234")).toBe(false);
    });

    it("should link chain when block is ancestor of UnknownAncestor chain", () => {
      const header = createHeader(100, "0x1234", "0x4567");
      const chain = createUnknownAncestorChain("0x1234", header, "0x4567");
      chain.ancestors.set("0x4567", createHeader(99, "0x4567", "0x7890"));
      unknownChainSync.backwardsChains.set("0x1234", chain);

      unknownChainSync.onProcessedBlock({slot: 99, block: "0x4567"});

      expect((chain as any).state).toBe(ChainState.Linked);
    });

    it("should not affect linked chains", () => {
      const header = createHeader(100, "0x1234", "0x4567");
      const chain = createLinkedChain("0x1234", header, [header]);
      unknownChainSync.backwardsChains.set("0x1234", chain);

      unknownChainSync.onProcessedBlock({slot: 99, block: "0x4567"});

      expect(chain.state).toBe(ChainState.Linked);
    });
  });

  describe("onFinalized", () => {
    it("should prune chains and headers for finalized epochs", () => {
      const header = createHeader(100, "0x1234", "0x4567");
      const chain = createUnknownHeadChain("0x1234");

      unknownChainSync.backwardsChains.set("0x1234", chain);
      unknownChainSync.headers.set("0x1234", header);
      unknownChainSync.blockRootsByEpoch.set(computeEpochAtSlot(100), new Set(["0x1234"]));

      const finalizedEpoch = computeEpochAtSlot(100) + 1;
      unknownChainSync.onFinalized({epoch: finalizedEpoch, rootHex: "0x9999"});

      expect(unknownChainSync.backwardsChains.has("0x1234")).toBe(false);
      expect(unknownChainSync.blockRootsByEpoch.has(computeEpochAtSlot(100))).toBe(false);
    });
  });

  describe("onPeerStatusUpdate", () => {
    it("should call onUnknownBlockRoot with peer head", () => {
      const spy = vi.spyOn(unknownChainSync, "onUnknownBlockRoot");
      const status = createStatus("0x1234");

      unknownChainSync.onPeerStatusUpdate({peer: "peer1", status});

      expect(spy).toHaveBeenCalledWith("0x1234", "peer1");
    });
  });

  describe("onUnknownBlockRoot", () => {
    it("should return early if block is already in fork choice", () => {
      mockChain.forkChoice.hasBlockHex = vi.fn().mockReturnValue(true);

      unknownChainSync.onUnknownBlockRoot("0x1234", "peer1");

      expect(unknownChainSync.backwardsChains.size).toBe(0);
    });

    it("should add peer to existing chain if header is tracked", () => {
      const header = createHeader(100, "0x1234", "0x4567");
      const chain = createUnknownHeadChain("0x1234");

      unknownChainSync.headers.set("0x1234", header);
      unknownChainSync.backwardsChains.set("0x1234", chain);

      unknownChainSync.onUnknownBlockRoot("0x1234", "peer2");

      expect(chain.peers.has("peer2")).toBe(true);
    });

    it("should add peer to chain with matching ancestor", () => {
      const header = createHeader(100, "0x1234", "0x4567");
      const chain = createUnknownAncestorChain("0x1234", header, "0x4567");
      chain.ancestors.set("0x4567", createHeader(99, "0x4567", "0x7890"));

      unknownChainSync.headers.set("0x4567", createHeader(99, "0x457", "0x7890"));
      unknownChainSync.backwardsChains.set("0x1234", chain);

      unknownChainSync.onUnknownBlockRoot("0x4567", "peer2");

      expect(chain.peers.has("peer2")).toBe(true);
    });

    it("should add peer to chain if block is earliest known ancestor", () => {
      const header = createHeader(100, "0x1234", "0x4567");
      const chain = createUnknownAncestorChain("0x1234", header, "0x4567");

      unknownChainSync.backwardsChains.set("0x1234", chain);

      unknownChainSync.onUnknownBlockRoot("0x4567", "peer2");

      expect(chain.peers.has("peer2")).toBe(true);
    });

    it("should create new chain for completely unknown block root", () => {
      unknownChainSync.onUnknownBlockRoot("0x1234", "peer1");

      expect(unknownChainSync.backwardsChains.has("0x1234")).toBe(true);
      const chain = unknownChainSync.backwardsChains.get("0x1234")!;
      expect(chain.state).toBe(ChainState.UnknownHead);
      expect(chain.headRoot).toBe("0x1234");
      expect(chain.peers.has("peer1")).toBe(true);
    });
  });

  describe("onUnknownBlockInput", () => {
    it("should return early if block is already in fork choice", () => {
      mockChain.forkChoice.hasBlockHex = vi.fn().mockReturnValue(true);
      const header = createHeader(100, "0x1234", "0x4567");

      unknownChainSync.onUnknownBlockInput(header, "peer1");

      expect(unknownChainSync.backwardsChains.size).toBe(0);
    });

    it("should add peer to existing chain if header is tracked", () => {
      const header = createHeader(100, "0x1234", "0x4567");
      const chain = createUnknownHeadChain("0x1234");

      unknownChainSync.headers.set("0x1234", header);
      unknownChainSync.backwardsChains.set("0x1234", chain);

      unknownChainSync.onUnknownBlockInput(header, "peer2");

      expect(chain.peers.has("peer2")).toBe(true);
    });

    it("should create new UnknownAncestor chain for new header", () => {
      const header = createHeader(100, "0x1234", "0x4567");

      unknownChainSync.onUnknownBlockInput(header, "peer1");

      expect(unknownChainSync.backwardsChains.has("0x1234")).toBe(true);
      const chain = unknownChainSync.backwardsChains.get("0x1234")! as UnknownAncestorBackwardsChain;
      expect(chain.state).toBe(ChainState.UnknownAncestor);
      expect(chain.headRoot).toBe("0x1234");
      expect(chain.head).toEqual(header);
      expect(chain.earliestKnownAncestor).toBe("0x4567");
      expect(chain.peers.has("peer1")).toBe(true);
    });
  });

  describe("onPeerDisconnect", () => {
    it("should remove peer from all chains", () => {
      const chain1 = createUnknownHeadChain("0x1234");
      const chain2 = createUnknownHeadChain("0x4567");
      chain1.peers.add("peer1");
      chain2.peers.add("peer1");

      unknownChainSync.backwardsChains.set("0x1234", chain1);
      unknownChainSync.backwardsChains.set("0x4567", chain2);

      unknownChainSync.onPeerDisconnect({peer: "peer1"});

      expect(chain1.peers.has("peer1")).toBe(false);
      expect(chain2.peers.has("peer1")).toBe(false);
    });
  });

  describe("pruneEntireChain", () => {
    it("should remove chain from backwardsChains map", () => {
      const chain = createUnknownHeadChain("0x1234");
      unknownChainSync.backwardsChains.set("0x1234", chain);

      unknownChainSync.pruneEntireChain(chain);

      expect(unknownChainSync.backwardsChains.has("0x1234")).toBe(false);
    });
  });

  describe("getRelatedHeaders", () => {
    it("should return headers in chronological order", () => {
      const header1 = createHeader(98, "0x7890", "0xabcd");
      const header2 = createHeader(99, "0x4567", "0x7890");
      const header3 = createHeader(100, "0x1234", "0x4567");

      unknownChainSync.headers.set("0x1234", header3);
      unknownChainSync.headers.set("0x4567", header2);
      unknownChainSync.headers.set("0x7890", header1);

      const related = unknownChainSync.getRelatedHeaders("0x1234");

      expect(related).toHaveLength(3);
      expect(related[0].slot).toBe(98);
      expect(related[1].slot).toBe(99);
      expect(related[2].slot).toBe(100);
    });

    it("should handle missing parent headers", () => {
      const header = createHeader(100, "0x1234", "0x4567");
      unknownChainSync.headers.set("0x1234", header);

      const related = unknownChainSync.getRelatedHeaders("0x1234");

      expect(related).toHaveLength(1);
      expect(related[0]).toEqual(header);
    });
  });

  describe("pruneFromChains", () => {
    it("should remove headers from global headers map", () => {
      const header = createHeader(100, "0x1234", "0x4567");
      unknownChainSync.headers.set("0x1234", header);

      unknownChainSync.pruneFromChains("0x1234");

      expect(unknownChainSync.headers.has("0x1234")).toBe(false);
    });

    it("should update chain earliest known ancestor when pruning ancestor", () => {
      const header1 = createHeader(99, "0x4567", "0x7890");
      const header2 = createHeader(100, "0x1234", "0x4567");
      const chain = createUnknownAncestorChain("0x1234", header2, "0x7890");
      chain.ancestors.set("0x4567", header1);

      unknownChainSync.headers.set("0x4567", header1);
      unknownChainSync.backwardsChains.set("0x1234", chain);

      unknownChainSync.pruneFromChains("0x4567");

      expect(chain.ancestors.has("0x4567")).toBe(false);
      expect(chain.earliestKnownAncestor).toBe("0x4567");
    });
  });

  describe("addHeader", () => {
    it("should add header to headers map and blockRootsByEpoch", () => {
      const header = createHeader(100, "0x1234", "0x4567");

      unknownChainSync.addHeader(header);

      expect(unknownChainSync.headers.get("0x1234")).toEqual(header);
      const epoch = computeEpochAtSlot(100);
      expect(unknownChainSync.blockRootsByEpoch.get(epoch)?.has("0x1234")).toBe(true);
    });

    it("should create new epoch set if it doesn't exist", () => {
      const header = createHeader(100, "0x1234", "0x4567");
      const epoch = computeEpochAtSlot(100);

      expect(unknownChainSync.blockRootsByEpoch.has(epoch)).toBe(false);

      unknownChainSync.addHeader(header);

      expect(unknownChainSync.blockRootsByEpoch.has(epoch)).toBe(true);
    });
  });

  describe("fetchBlock", () => {
    it("should return undefined for linked chain", async () => {
      const header = createHeader(100, "0x1234", "0x4567");
      const chain = createLinkedChain("0x1234", header, [header]);

      const result = await unknownChainSync.fetchBlock(chain, "peer1");

      expect(result).toBeUndefined();
    });

    it("should fetch head root for UnknownHead chain", async () => {
      const chain = createUnknownHeadChain("0x1234");
      const mockBlock = {
        data: {
          message: {
            slot: 100,
            parentRoot: fromHex("0x4567"),
          },
        },
      };
      mockNetwork.sendBeaconBlocksByRoot = vi.fn().mockResolvedValue([mockBlock]);
      mockConfig.getForkTypes = vi.fn().mockReturnValue({
        BeaconBlock: {
          hashTreeRoot: vi.fn().mockReturnValue(fromHex("0x1234")),
        },
      });

      const result = await unknownChainSync.fetchBlock(chain, "peer1");

      expect(mockNetwork.sendBeaconBlocksByRoot).toHaveBeenCalledWith("peer1", [fromHex("0x1234")]);
      expect(result).toEqual({
        slot: 100,
        root: "0x1234",
        parentRoot: "0x4567",
      });
    });

    it("should fetch earliest known ancestor for UnknownAncestor chain", async () => {
      const header = createHeader(100, "0x1234", "0x4567");
      const chain = createUnknownAncestorChain("0x1234", header, "0x4567");
      const mockBlock = {
        data: {
          message: {
            slot: 99,
            parentRoot: fromHex("0x7890"),
          },
        },
      };
      mockNetwork.sendBeaconBlocksByRoot = vi.fn().mockResolvedValue([mockBlock]);
      mockConfig.getForkTypes = vi.fn().mockReturnValue({
        BeaconBlock: {
          hashTreeRoot: vi.fn().mockReturnValue(fromHex("0x4567")),
        },
      });

      const result = await unknownChainSync.fetchBlock(chain, "peer1");

      expect(mockNetwork.sendBeaconBlocksByRoot).toHaveBeenCalledWith("peer1", [fromHex("0x4567")]);
      expect(result).toEqual({
        slot: 99,
        root: "0x4567",
        parentRoot: "0x7890",
      });
    });

    it("should handle missing block response", async () => {
      const chain = createUnknownHeadChain("0x1234");
      mockNetwork.sendBeaconBlocksByRoot = vi.fn().mockResolvedValue([undefined]);

      const result = await unknownChainSync.fetchBlock(chain, "peer1");

      expect(mockNetwork.reportPeer).toHaveBeenCalledWith(
        "peer1",
        PeerAction.MidToleranceError,
        "Missing block response from peer-advertised head"
      );
      expect(chain.peers.has("peer1")).toBe(false);
      expect(result).toBeUndefined();
    });

    it("should handle incorrect block response", async () => {
      const chain = createUnknownHeadChain("0x1234");
      const mockBlock = {
        data: {
          message: {
            slot: 100,
            parentRoot: fromHex("0x4567"),
          },
        },
      };
      mockNetwork.sendBeaconBlocksByRoot = vi.fn().mockResolvedValue([mockBlock]);
      mockConfig.getForkTypes = vi.fn().mockReturnValue({
        BeaconBlock: {
          hashTreeRoot: vi.fn().mockReturnValue(fromHex("0x9999")), // Different root
        },
      });

      const result = await unknownChainSync.fetchBlock(chain, "peer1");

      expect(mockNetwork.reportPeer).toHaveBeenCalledWith(
        "peer1",
        PeerAction.Fatal,
        "Incorrect block response from peer-advertised head"
      );
      expect(chain.peers.has("peer1")).toBe(false);
      expect(result).toBeUndefined();
    });

    it("should handle rate limiting errors", async () => {
      const chain = createUnknownHeadChain("0x1234");
      const rateLimitError = new RequestError({code: RequestErrorCode.REQUEST_RATE_LIMITED} as any, "Rate limited");
      mockNetwork.sendBeaconBlocksByRoot = vi.fn().mockRejectedValue(rateLimitError);

      const result = await unknownChainSync.fetchBlock(chain, "peer1");

      expect(mockNetwork.reportPeer).not.toHaveBeenCalled();
      expect(result).toBeUndefined();
    });

    it("should handle other errors", async () => {
      const chain = createUnknownHeadChain("0x1234");
      const error = new RequestError({code: RequestErrorCode.REQUEST_TIMEOUT} as any, "Timeout");
      mockNetwork.sendBeaconBlocksByRoot = vi.fn().mockRejectedValue(error);

      const result = await unknownChainSync.fetchBlock(chain, "peer1");

      expect(mockNetwork.reportPeer).toHaveBeenCalledWith(
        "peer1",
        PeerAction.LowToleranceError,
        "Error fetching block response from peer"
      );
      expect(chain.peers.has("peer1")).toBe(false);
      expect(result).toBeUndefined();
    });
  });

  describe("newEarliestKnownAncestor", () => {
    it("should link chain if parent is in fork choice", () => {
      const header = createHeader(100, "0x1234", "0x4567");
      const chain = createUnknownAncestorChain("0x1234", header, "0x4567");
      mockChain.forkChoice.hasBlockHex = vi.fn().mockReturnValue(true);

      unknownChainSync.newEarliestKnownAncestor(chain, header);

      expect((chain as any).state).toBe(ChainState.Linked);
    });

    it("should merge with parent chain if parent is a chain head", () => {
      const header = createHeader(100, "0x1234", "0x4567");
      const chain = createUnknownAncestorChain("0x1234", header, "0x4567");
      const parentHeader = createHeader(99, "0x4567", "0x7890");
      const parentChain = createUnknownAncestorChain("0x4567", parentHeader, "0x7890");

      unknownChainSync.headers.set("0x4567", parentHeader);
      unknownChainSync.backwardsChains.set("0x4567", parentChain);

      unknownChainSync.newEarliestKnownAncestor(chain, header);

      expect(unknownChainSync.backwardsChains.has("0x4567")).toBe(false);
      expect(chain.peers.size).toBeGreaterThan(0);
    });

    it("should advance chain with known ancestors", () => {
      const header = createHeader(100, "0x1234", "0x4567");
      const chain = createUnknownAncestorChain("0x1234", header, "0x4567");
      const ancestor1 = createHeader(99, "0x4567", "0x7890");
      const ancestor2 = createHeader(98, "0x7890", "0xabcd");

      unknownChainSync.headers.set("0x4567", ancestor1);
      unknownChainSync.headers.set("0x7890", ancestor2);

      unknownChainSync.newEarliestKnownAncestor(chain, header);

      expect(chain.ancestors.has("0x4567")).toBe(true);
      expect(chain.ancestors.has("0x7890")).toBe(true);
    });

    it("should advance other chains that can be advanced", () => {
      const header = createHeader(100, "0x1234", "0x4567");
      const chain = createUnknownAncestorChain("0x1234", header, "0x4567");
      const otherHeader = createHeader(101, "0x9999", "0x1234");
      const otherChain = createUnknownAncestorChain("0x9999", otherHeader, "0x1234");

      unknownChainSync.headers.set("0x1234", header);
      unknownChainSync.backwardsChains.set("0x1234", chain);
      unknownChainSync.backwardsChains.set("0x9999", otherChain);

      unknownChainSync.newEarliestKnownAncestor(chain, header);

      expect(otherChain.ancestors.has("0x1234")).toBe(true);
    });
  });

  describe("processBackwardsChain", () => {
    it("should return early if chain no longer exists", async () => {
      const chain = createUnknownHeadChain("0x1234");

      await unknownChainSync.processBackwardsChain(chain);

      // Should not throw or cause issues
    });

    it("should return early if chain is already being fetched", async () => {
      const chain = createUnknownHeadChain("0x1234");
      chain.downloadState = DownloadState.Fetching;
      unknownChainSync.backwardsChains.set("0x1234", chain);

      await unknownChainSync.processBackwardsChain(chain);

      expect(chain.downloadState).toBe(DownloadState.Fetching);
    });

    it("should process unknown chain", async () => {
      const chain = createUnknownHeadChain("0x1234");
      unknownChainSync.backwardsChains.set("0x1234", chain);

      const spy = vi.spyOn(unknownChainSync, "processUnknown").mockResolvedValue();

      await unknownChainSync.processBackwardsChain(chain);

      expect(spy).toHaveBeenCalledWith(chain);
    });

    it("should process linked chain", async () => {
      const header = createHeader(100, "0x1234", "0x4567");
      const chain = createLinkedChain("0x1234", header, [header]);
      unknownChainSync.backwardsChains.set("0x1234", chain);

      await unknownChainSync.processBackwardsChain(chain);

      expect(mockProcessLinkedChain).toHaveBeenCalledWith(chain);
    });
  });

  describe("processUnknown", () => {
    it("should set download state to fetching and back to idle", async () => {
      const chain = createUnknownHeadChain("0x1234");
      chain.peers.add("peer1");
      unknownChainSync.backwardsChains.set("0x1234", chain);

      const mockBlock = {
        data: {
          message: {
            slot: 100,
            parentRoot: fromHex("0x4567"),
          },
        },
      };
      mockNetwork.sendBeaconBlocksByRoot = vi.fn().mockResolvedValue([mockBlock]);
      mockConfig.getForkTypes = vi.fn().mockReturnValue({
        BeaconBlock: {
          hashTreeRoot: vi.fn().mockReturnValue(fromHex("0x1234")),
        },
      });

      expect(chain.downloadState).toBe(DownloadState.Idle);

      await unknownChainSync.processUnknown(chain);

      expect(chain.downloadState).toBe(DownloadState.Idle);
    });

    it("should mark download as failed when no peers can provide block", async () => {
      const chain = createUnknownHeadChain("0x1234");
      chain.peers.add("peer1");
      unknownChainSync.backwardsChains.set("0x1234", chain);

      mockNetwork.sendBeaconBlocksByRoot = vi.fn().mockResolvedValue([undefined]);

      await unknownChainSync.processUnknown(chain);

      expect(chain.downloadState).toBe(DownloadState.Failed);
    });

    it("should return early if chain is removed during fetch", async () => {
      const chain = createUnknownHeadChain("0x1234");
      chain.peers.add("peer1");
      unknownChainSync.backwardsChains.set("0x1234", chain);

      const mockBlock = {
        data: {
          message: {
            slot: 100,
            parentRoot: fromHex("0x4567"),
          },
        },
      };

      // Mock network call that removes chain during execution
      mockNetwork.sendBeaconBlocksByRoot = vi.fn().mockImplementation(async () => {
        unknownChainSync.backwardsChains.delete("0x1234");
        return [mockBlock];
      });

      await unknownChainSync.processUnknown(chain);

      // Should not throw or cause issues
    });

    it("should advance chain and add header when block is fetched successfully", async () => {
      const chain = createUnknownHeadChain("0x1234");
      chain.peers.add("peer1");
      unknownChainSync.backwardsChains.set("0x1234", chain);

      const mockBlock = {
        data: {
          message: {
            slot: 100,
            parentRoot: fromHex("0x4567"),
          },
        },
      };
      mockNetwork.sendBeaconBlocksByRoot = vi.fn().mockResolvedValue([mockBlock]);
      mockConfig.getForkTypes = vi.fn().mockReturnValue({
        BeaconBlock: {
          hashTreeRoot: vi.fn().mockReturnValue(fromHex("0x1234")),
        },
      });

      const addHeaderSpy = vi.spyOn(unknownChainSync, "addHeader");
      const newEarliestKnownAncestorSpy = vi.spyOn(unknownChainSync, "newEarliestKnownAncestor");

      await unknownChainSync.processUnknown(chain);

      expect(addHeaderSpy).toHaveBeenCalled();
      expect(newEarliestKnownAncestorSpy).toHaveBeenCalled();
    });
  });

  describe("edge cases and error handling", () => {
    it("should handle empty peer sets gracefully", () => {
      const chain = createUnknownHeadChain("0x1234");
      chain.peers.clear();
      unknownChainSync.backwardsChains.set("0x1234", chain);

      unknownChainSync.onPeerDisconnect({peer: "nonexistent"});

      expect(chain.peers.size).toBe(0);
    });

    it("should handle metrics collection without errors", () => {
      const header1 = createHeader(100, "0x1234", "0x4567");
      const header2 = createHeader(101, "0x7890", "0xabca");
      const chain1 = createUnknownHeadChain("0x1234");
      const chain2 = createLinkedChain("0x7890", header2, [header2]);

      unknownChainSync.headers.set("0x1234", header1);
      unknownChainSync.headers.set("0x7890", header2);
      unknownChainSync.backwardsChains.set("0x1234", chain1);
      unknownChainSync.backwardsChains.set("0x7890", chain2);

      // Trigger metrics collection
      const addCollectMock = mockMetrics.headerCount.addCollect as any;
      const collectFn = addCollectMock.mock.calls[0][0];
      expect(() => collectFn()).not.toThrow();
    });

    it("should handle concurrent chain operations", () => {
      const chain = createUnknownHeadChain("0x1234");
      unknownChainSync.backwardsChains.set("0x1234", chain);

      // Simulate concurrent operations
      unknownChainSync.onUnknownBlockRoot("0x1234", "peer1");
      unknownChainSync.onUnknownBlockRoot("0x1234", "peer2");
      unknownChainSync.onPeerDisconnect({peer: "peer1"});

      expect(chain.peers.has("peer2")).toBe(true);
      expect(chain.peers.has("peer1")).toBe(false);
    });

    it("should handle malformed block roots", () => {
      // Test with various edge case block roots
      const edgeCases = ["", "0x", "invalid", "0x1234"];

      for (const blockRoot of edgeCases) {
        expect(() => {
          unknownChainSync.onUnknownBlockRoot(blockRoot as RootHex, "peer1");
        }).not.toThrow();
      }
    });
  });

  describe("integration scenarios", () => {
    it("should handle complete chain discovery workflow", async () => {
      // Start with unknown block root
      unknownChainSync.onUnknownBlockRoot("0x1234", "peer1");

      const chain = unknownChainSync.backwardsChains.get("0x1234");
      expect(chain?.state).toBe(ChainState.UnknownHead);

      // Simulate fetching the head block
      const mockBlock = {
        data: {
          message: {
            slot: 100,
            parentRoot: fromHex("0x4567"),
          },
        },
      };
      mockNetwork.sendBeaconBlocksByRoot = vi.fn().mockResolvedValue([mockBlock]);
      mockConfig.getForkTypes = vi.fn().mockReturnValue({
        BeaconBlock: {
          hashTreeRoot: vi.fn().mockReturnValue(fromHex("0x1234")),
        },
      });

      await unknownChainSync.processUnknown(chain!);

      // Chain should now be UnknownAncestor
      expect((chain as any).state).toBe(ChainState.UnknownAncestor);

      // Simulate parent being processed
      unknownChainSync.onProcessedBlock({slot: 100, block: "0x4567"});

      // Chain should now be linked
      expect((chain as any).state).toBe(ChainState.Linked);
    });

    it("should handle chain merging scenario", () => {
      // Create two chains that should be merged
      const header1 = createHeader(100, "0x1234", "0x4567");
      const header2 = createHeader(99, "0x4567", "0x7890");

      const chain1 = createUnknownAncestorChain("0x1234", header1, "0x4567");
      const chain2 = createUnknownAncestorChain("0x4567", header2, "0x7890");

      unknownChainSync.headers.set("0x4567", header2);
      unknownChainSync.backwardsChains.set("0x1234", chain1);
      unknownChainSync.backwardsChains.set("0x4567", chain2);

      unknownChainSync.newEarliestKnownAncestor(chain1, header1);

      // Chain2 should be removed and merged into chain1
      expect(unknownChainSync.backwardsChains.has("0x4567")).toBe(false);
      expect(chain1.earliestKnownAncestor).toBe("0x7890");
    });

    it("should handle finalization cleanup", () => {
      const header = createHeader(100, "0x1234", "0x4567");
      const chain = createUnknownHeadChain("0x1234");
      const epoch = computeEpochAtSlot(100);

      unknownChainSync.backwardsChains.set("0x1234", chain);
      unknownChainSync.headers.set("0x1234", header);
      unknownChainSync.blockRootsByEpoch.set(epoch, new Set(["0x1234"]));

      // Finalize beyond this epoch
      unknownChainSync.onFinalized({epoch: epoch + 2, rootHex: "0x999"});

      expect(unknownChainSync.backwardsChains.has("0x1234")).toBe(false);
      expect(unknownChainSync.headers.has("0x1234")).toBe(false);
      expect(unknownChainSync.blockRootsByEpoch.has(epoch)).toBe(false);
    });
  });
});
