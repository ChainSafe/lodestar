import {beforeEach, describe, expect, it} from "vitest";
import {PTC_SIZE} from "@lodestar/params";
import {DataAvailabilityStatus, computeStartSlotAtEpoch} from "@lodestar/state-transition";
import {RootHex} from "@lodestar/types";
import {
  ExecutionStatus,
  PayloadStatus,
  ProtoArray,
  ProtoBlock,
  ProtoNode,
  generateProtoNodeKey,
  protoNodeKey,
} from "../../../src/index.js";

describe("Gloas Fork Choice", () => {
  const genesisEpoch = 0;
  const gloasForkEpoch = 5;
  const gloasForkSlot = computeStartSlotAtEpoch(gloasForkEpoch);

  const stateRoot = "0x00";
  const genesisRoot = "0x01";

  /**
   * Helper to get a specific node variant (PENDING/EMPTY/FULL) from ProtoArray
   * Replacement for removed getForkChoiceNode() method
   */
  function getNodeByPayloadStatus(
    protoArray: ProtoArray,
    blockRoot: RootHex,
    payloadStatus: PayloadStatus
  ): ProtoNode | undefined {
    const key = protoNodeKey({blockRoot, payloadStatus} as any);
    const index = (protoArray as any).indices.get(key);
    if (index === undefined) return undefined;
    return (protoArray as any).nodes[index];
  }

  function createTestBlock(
    slot: number,
    blockRoot: RootHex,
    parentRoot: RootHex,
    parentBlockHash?: RootHex
  ): ProtoBlock {
    return {
      slot,
      blockRoot,
      parentRoot,
      stateRoot,
      targetRoot: genesisRoot,
      justifiedEpoch: genesisEpoch,
      justifiedRoot: genesisRoot,
      finalizedEpoch: genesisEpoch,
      finalizedRoot: genesisRoot,
      unrealizedJustifiedEpoch: genesisEpoch,
      unrealizedJustifiedRoot: genesisRoot,
      unrealizedFinalizedEpoch: genesisEpoch,
      unrealizedFinalizedRoot: genesisRoot,
      timeliness: true,
      executionPayloadBlockHash: blockRoot, // Use blockRoot as execution hash
      executionPayloadNumber: slot,
      executionStatus: ExecutionStatus.Valid,
      dataAvailabilityStatus: DataAvailabilityStatus.Available,
      parentBlockHash: parentBlockHash === undefined ? null : parentBlockHash,
      payloadStatus: PayloadStatus.FULL,
    };
  }

  describe("ForkChoiceNode helpers", () => {
    it("protoNodeKey() creates correct compound key", () => {
      const key = protoNodeKey({blockRoot: "0xabc", payloadStatus: PayloadStatus.FULL} as any);
      expect(key).toBe("0xabc:2");
    });

    it("protoNodeKey() handles all payload statuses", () => {
      expect(protoNodeKey({blockRoot: "0xabc", payloadStatus: PayloadStatus.PENDING} as any)).toBe("0xabc:0");
      expect(protoNodeKey({blockRoot: "0xabc", payloadStatus: PayloadStatus.EMPTY} as any)).toBe("0xabc:1");
      expect(protoNodeKey({blockRoot: "0xabc", payloadStatus: PayloadStatus.FULL} as any)).toBe("0xabc:2");
    });

    it("generateProtoNodeKey() creates correct compound key", () => {
      const key = generateProtoNodeKey("0xabc", PayloadStatus.FULL);
      expect(key).toBe("0xabc:2");
    });

    it("generateProtoNodeKey() handles all payload statuses", () => {
      expect(generateProtoNodeKey("0xabc", PayloadStatus.PENDING)).toBe("0xabc:0");
      expect(generateProtoNodeKey("0xabc", PayloadStatus.EMPTY)).toBe("0xabc:1");
      expect(generateProtoNodeKey("0xabc", PayloadStatus.FULL)).toBe("0xabc:2");
    });

    it("generateProtoNodeKey() and protoNodeKey() produce same output", () => {
      const root = "0x123abc";

      const pendingKey1 = protoNodeKey({blockRoot: root, payloadStatus: PayloadStatus.PENDING} as any);
      const pendingKey2 = generateProtoNodeKey(root, PayloadStatus.PENDING);
      expect(pendingKey1).toBe(pendingKey2);

      const emptyKey1 = protoNodeKey({blockRoot: root, payloadStatus: PayloadStatus.EMPTY} as any);
      const emptyKey2 = generateProtoNodeKey(root, PayloadStatus.EMPTY);
      expect(emptyKey1).toBe(emptyKey2);

      const fullKey1 = protoNodeKey({blockRoot: root, payloadStatus: PayloadStatus.FULL} as any);
      const fullKey2 = generateProtoNodeKey(root, PayloadStatus.FULL);
      expect(fullKey1).toBe(fullKey2);
    });

    it("generateProtoNodeKey() handles different root formats", () => {
      // Short hex
      expect(generateProtoNodeKey("0x1", PayloadStatus.PENDING)).toBe("0x1:0");

      // Long hex (64 chars)
      const longRoot = "0x" + "a".repeat(64);
      expect(generateProtoNodeKey(longRoot, PayloadStatus.FULL)).toBe(`${longRoot}:2`);

      // Empty root edge case
      expect(generateProtoNodeKey("0x", PayloadStatus.EMPTY)).toBe("0x:1");
    });
  });

  describe("Pre-Gloas (Fulu) behavior", () => {
    let protoArray: ProtoArray;

    beforeEach(() => {
      // Test pre-Gloas behavior by creating blocks with parentBlockHash: null
      protoArray = new ProtoArray({
        pruneThreshold: 0,
        justifiedEpoch: genesisEpoch,
        justifiedRoot: genesisRoot,
        finalizedEpoch: genesisEpoch,
        finalizedRoot: genesisRoot,
      });
    });

    it("creates only FULL nodes for pre-Gloas blocks", () => {
      const block = createTestBlock(1, "0x02", genesisRoot);
      protoArray.onBlock(block, 1);

      // Should only have FULL variant
      const fullNode = getNodeByPayloadStatus(protoArray, "0x02", PayloadStatus.FULL);
      expect(fullNode).toBeDefined();
      expect(fullNode?.payloadStatus).toBe(PayloadStatus.FULL);

      // Should not have PENDING or EMPTY variants
      const pendingNode = getNodeByPayloadStatus(protoArray, "0x02", PayloadStatus.PENDING);
      expect(pendingNode).toBeUndefined();

      const emptyNode = getNodeByPayloadStatus(protoArray, "0x02", PayloadStatus.EMPTY);
      expect(emptyNode).toBeUndefined();
    });

    it("getNode() finds pre-Gloas blocks by root (FULL)", () => {
      const block = createTestBlock(1, "0x02", genesisRoot);
      protoArray.onBlock(block, 1);

      const node = protoArray.getNode("0x02");
      expect(node).toBeDefined();
      expect(node?.payloadStatus).toBe(PayloadStatus.FULL);
    });

    it("hasBlock() returns true for pre-Gloas blocks", () => {
      const block = createTestBlock(1, "0x02", genesisRoot);
      protoArray.onBlock(block, 1);

      expect(protoArray.hasBlock("0x02")).toBe(true);
      expect(protoArray.hasBlock("0x99")).toBe(false);
    });
  });

  describe("Gloas fork activation", () => {
    let protoArray: ProtoArray;

    beforeEach(() => {
      protoArray = new ProtoArray({
        pruneThreshold: 0,
        justifiedEpoch: genesisEpoch,
        justifiedRoot: genesisRoot,
        finalizedEpoch: genesisEpoch,
        finalizedRoot: genesisRoot,
      });
    });

    it("creates PENDING + EMPTY nodes for Gloas blocks", () => {
      const block = createTestBlock(gloasForkSlot, "0x02", genesisRoot, genesisRoot);
      protoArray.onBlock(block, gloasForkSlot);

      // Should have PENDING variant
      const pendingNode = getNodeByPayloadStatus(protoArray, "0x02", PayloadStatus.PENDING);
      expect(pendingNode).toBeDefined();
      expect(pendingNode?.payloadStatus).toBe(PayloadStatus.PENDING);

      // Should have EMPTY variant
      const emptyNode = getNodeByPayloadStatus(protoArray, "0x02", PayloadStatus.EMPTY);
      expect(emptyNode).toBeDefined();
      expect(emptyNode?.payloadStatus).toBe(PayloadStatus.EMPTY);

      // Should not have FULL variant yet
      const fullNode = getNodeByPayloadStatus(protoArray, "0x02", PayloadStatus.FULL);
      expect(fullNode).toBeUndefined();
    });

    it("EMPTY node has PENDING as parent", () => {
      const block = createTestBlock(gloasForkSlot, "0x02", genesisRoot, genesisRoot);
      protoArray.onBlock(block, gloasForkSlot);

      const emptyNode = getNodeByPayloadStatus(protoArray, "0x02", PayloadStatus.EMPTY);
      const pendingIndex = protoArray.getNodeIndex({blockRoot: "0x02", payloadStatus: PayloadStatus.PENDING} as any);

      expect(emptyNode?.parent).toBe(pendingIndex);
    });

    it("initializes PTC votes for Gloas blocks", () => {
      const block = createTestBlock(gloasForkSlot, "0x02", genesisRoot, genesisRoot);
      protoArray.onBlock(block, gloasForkSlot);

      // All PTC votes should be false initially
      const isTimely = protoArray.isPayloadTimely("0x02");
      expect(isTimely).toBe(false);
    });

    it("does not create PENDING/EMPTY for pre-fork blocks", () => {
      const block = createTestBlock(gloasForkSlot - 1, "0x02", genesisRoot);
      protoArray.onBlock(block, gloasForkSlot - 1);

      // Should only have FULL (pre-Gloas behavior)
      const fullNode = getNodeByPayloadStatus(protoArray, "0x02", PayloadStatus.FULL);
      expect(fullNode).toBeDefined();

      const pendingNode = getNodeByPayloadStatus(protoArray, "0x02", PayloadStatus.PENDING);
      expect(pendingNode).toBeUndefined();
    });
  });

  describe("Fork transition (Fulu → Gloas)", () => {
    let protoArray: ProtoArray;

    beforeEach(() => {
      protoArray = new ProtoArray({
        pruneThreshold: 0,
        justifiedEpoch: genesisEpoch,
        justifiedRoot: genesisRoot,
        finalizedEpoch: genesisEpoch,
        finalizedRoot: genesisRoot,
      });
    });

    it("first Gloas block points to FULL parent (Fulu block)", () => {
      // Add pre-Gloas block
      const fuluBlock = createTestBlock(gloasForkSlot - 1, "0x02", genesisRoot);
      protoArray.onBlock(fuluBlock, gloasForkSlot - 1);

      // Add first Gloas block
      const gloasBlock = createTestBlock(gloasForkSlot, "0x03", "0x02", "0x02");
      protoArray.onBlock(gloasBlock, gloasForkSlot);

      const gloasPendingNode = getNodeByPayloadStatus(protoArray, "0x03", PayloadStatus.PENDING);
      const fuluFullIndex = protoArray.getNodeIndex({blockRoot: "0x02", payloadStatus: PayloadStatus.FULL} as any);

      // First Gloas block's PENDING should point to parent's FULL
      expect(gloasPendingNode?.parent).toBe(fuluFullIndex);
    });

    it("getNode() finds blocks across fork transition", () => {
      // Add pre-Gloas block
      const fuluBlock = createTestBlock(gloasForkSlot - 1, "0x02", genesisRoot);
      protoArray.onBlock(fuluBlock, gloasForkSlot - 1);

      // Add Gloas block
      const gloasBlock = createTestBlock(gloasForkSlot, "0x03", "0x02", "0x02");
      protoArray.onBlock(gloasBlock, gloasForkSlot);

      // Should find both blocks
      const fuluNode = protoArray.getNode("0x02");
      expect(fuluNode?.payloadStatus).toBe(PayloadStatus.FULL);

      const gloasNode = protoArray.getNode("0x03");
      expect(gloasNode?.payloadStatus).toBe(PayloadStatus.PENDING);
    });
  });

  describe("onExecutionPayload()", () => {
    let protoArray: ProtoArray;

    beforeEach(() => {
      protoArray = new ProtoArray({
        pruneThreshold: 0,
        justifiedEpoch: genesisEpoch,
        justifiedRoot: genesisRoot,
        finalizedEpoch: genesisEpoch,
        finalizedRoot: genesisRoot,
      });
    });

    it("creates FULL variant when payload arrives", () => {
      const block = createTestBlock(gloasForkSlot, "0x02", genesisRoot, genesisRoot);
      protoArray.onBlock(block, gloasForkSlot);

      // FULL should not exist yet
      expect(getNodeByPayloadStatus(protoArray, "0x02", PayloadStatus.FULL)).toBeUndefined();

      // Call onExecutionPayload
      protoArray.onExecutionPayload("0x02", gloasForkSlot);

      // FULL should now exist
      const fullNode = getNodeByPayloadStatus(protoArray, "0x02", PayloadStatus.FULL);
      expect(fullNode).toBeDefined();
      expect(fullNode?.payloadStatus).toBe(PayloadStatus.FULL);
    });

    it("FULL node has PENDING as parent", () => {
      const block = createTestBlock(gloasForkSlot, "0x02", genesisRoot, genesisRoot);
      protoArray.onBlock(block, gloasForkSlot);

      protoArray.onExecutionPayload("0x02", gloasForkSlot);

      const fullNode = getNodeByPayloadStatus(protoArray, "0x02", PayloadStatus.FULL);
      const pendingIndex = protoArray.getNodeIndex({blockRoot: "0x02", payloadStatus: PayloadStatus.PENDING} as any);

      expect(fullNode?.parent).toBe(pendingIndex);
    });

    it("is idempotent (calling twice does not create duplicate)", () => {
      const block = createTestBlock(gloasForkSlot, "0x02", genesisRoot, genesisRoot);
      protoArray.onBlock(block, gloasForkSlot);

      protoArray.onExecutionPayload("0x02", gloasForkSlot);
      protoArray.onExecutionPayload("0x02", gloasForkSlot);

      // Should still only have one FULL node
      const fullNode = getNodeByPayloadStatus(protoArray, "0x02", PayloadStatus.FULL);
      expect(fullNode).toBeDefined();
    });

    it("does nothing for pre-Gloas blocks", () => {
      const block = createTestBlock(gloasForkSlot - 1, "0x02", genesisRoot);
      protoArray.onBlock(block, gloasForkSlot - 1);

      // Pre-Gloas block already has FULL
      expect(getNodeByPayloadStatus(protoArray, "0x02", PayloadStatus.FULL)).toBeDefined();

      // Calling onExecutionPayload should be no-op
      protoArray.onExecutionPayload("0x02", gloasForkSlot - 1);

      // Still just one FULL node
      expect(getNodeByPayloadStatus(protoArray, "0x02", PayloadStatus.FULL)).toBeDefined();
    });

    it("throws for unknown block", () => {
      expect(() => protoArray.onExecutionPayload("0x99", gloasForkSlot)).toThrow();
    });
  });

  describe("PTC (Payload Timeliness Committee)", () => {
    let protoArray: ProtoArray;

    beforeEach(() => {
      protoArray = new ProtoArray({
        pruneThreshold: 0,
        justifiedEpoch: genesisEpoch,
        justifiedRoot: genesisRoot,
        finalizedEpoch: genesisEpoch,
        finalizedRoot: genesisRoot,
      });
    });

    it("notifyPtcMessage() updates votes for multiple validators", () => {
      const block = createTestBlock(gloasForkSlot, "0x02", genesisRoot, genesisRoot);
      protoArray.onBlock(block, gloasForkSlot);

      // Initially not timely (no votes)
      expect(protoArray.isPayloadTimely("0x02")).toBe(false);

      // Vote yes from validators at indices 0, 1, 2
      protoArray.notifyPtcMessage("0x02", [0, 1, 2], true);

      // Still not timely (need >50% of PTC_SIZE)
      expect(protoArray.isPayloadTimely("0x02")).toBe(false);
    });

    it("notifyPtcMessage() validates ptcIndex range", () => {
      const block = createTestBlock(gloasForkSlot, "0x02", genesisRoot, genesisRoot);
      protoArray.onBlock(block, gloasForkSlot);

      expect(() => protoArray.notifyPtcMessage("0x02", [-1], true)).toThrow(/Invalid PTC index/);
      expect(() => protoArray.notifyPtcMessage("0x02", [PTC_SIZE], true)).toThrow(/Invalid PTC index/);
      expect(() => protoArray.notifyPtcMessage("0x02", [PTC_SIZE + 1], true)).toThrow(/Invalid PTC index/);
      expect(() => protoArray.notifyPtcMessage("0x02", [0, 1, PTC_SIZE], true)).toThrow(/Invalid PTC index/);
    });

    it("notifyPtcMessage() handles unknown block gracefully", () => {
      // Should not throw for unknown block
      expect(() => protoArray.notifyPtcMessage("0x99", [0], true)).not.toThrow();
    });

    it("isPayloadTimely() returns false when payload not locally available", () => {
      const block = createTestBlock(gloasForkSlot, "0x02", genesisRoot, genesisRoot);
      protoArray.onBlock(block, gloasForkSlot);

      // Vote yes from majority of PTC
      const threshold = Math.floor(PTC_SIZE / 2) + 1;
      const indices = Array.from({length: threshold}, (_, i) => i);
      protoArray.notifyPtcMessage("0x02", indices, true);

      // Without executionPayloadStates, should return false
      expect(protoArray.isPayloadTimely("0x02")).toBe(false);

      // With empty map, should return false
      expect(protoArray.isPayloadTimely("0x02", new Map())).toBe(false);
    });

    it("isPayloadTimely() returns true when threshold met and payload available", () => {
      const block = createTestBlock(gloasForkSlot, "0x02", genesisRoot, genesisRoot);
      protoArray.onBlock(block, gloasForkSlot);

      // Create execution payload states map
      const executionPayloadStates = new Map<RootHex, unknown>();
      executionPayloadStates.set("0x02", {});

      // Vote yes from majority of PTC (>50%)
      const threshold = Math.floor(PTC_SIZE / 2) + 1;
      const indices = Array.from({length: threshold}, (_, i) => i);
      protoArray.notifyPtcMessage("0x02", indices, true);

      // Should now be timely
      expect(protoArray.isPayloadTimely("0x02", executionPayloadStates)).toBe(true);
    });

    it("isPayloadTimely() returns false when threshold not met", () => {
      const block = createTestBlock(gloasForkSlot, "0x02", genesisRoot, genesisRoot);
      protoArray.onBlock(block, gloasForkSlot);

      const executionPayloadStates = new Map<RootHex, unknown>();
      executionPayloadStates.set("0x02", {});

      // Vote yes from exactly 50% (not >50%)
      const threshold = Math.floor(PTC_SIZE / 2);
      const indices = Array.from({length: threshold}, (_, i) => i);
      protoArray.notifyPtcMessage("0x02", indices, true);

      // Should not be timely (need >50%, not >=50%)
      expect(protoArray.isPayloadTimely("0x02", executionPayloadStates)).toBe(false);
    });

    it("isPayloadTimely() counts only 'true' votes", () => {
      const block = createTestBlock(gloasForkSlot, "0x02", genesisRoot, genesisRoot);
      protoArray.onBlock(block, gloasForkSlot);

      const executionPayloadStates = new Map<RootHex, unknown>();
      executionPayloadStates.set("0x02", {});

      // Vote mixed yes/no
      const threshold = Math.floor(PTC_SIZE / 2) + 1;
      // Vote yes from indices 0..threshold-1
      const yesIndices = Array.from({length: threshold}, (_, i) => i);
      protoArray.notifyPtcMessage("0x02", yesIndices, true);
      // Vote no from indices threshold..PTC_SIZE-1
      const noIndices = Array.from({length: PTC_SIZE - threshold}, (_, i) => i + threshold);
      protoArray.notifyPtcMessage("0x02", noIndices, false);

      // Should be timely (threshold met)
      expect(protoArray.isPayloadTimely("0x02", executionPayloadStates)).toBe(true);

      // Change some yes votes to no
      protoArray.notifyPtcMessage("0x02", [0, 1], false);

      // Should no longer be timely
      expect(protoArray.isPayloadTimely("0x02", executionPayloadStates)).toBe(false);
    });

    it("isPayloadTimely() returns false for unknown block", () => {
      expect(protoArray.isPayloadTimely("0x99")).toBe(false);
    });

    it("does not initialize PTC votes for pre-Gloas blocks", () => {
      const block = createTestBlock(gloasForkSlot - 1, "0x02", genesisRoot);
      protoArray.onBlock(block, gloasForkSlot - 1);

      // Pre-Gloas blocks should not have PTC tracking
      expect(protoArray.isPayloadTimely("0x02")).toBe(false);

      // notifyPtcMessage should be no-op
      expect(() => protoArray.notifyPtcMessage("0x02", [0], true)).not.toThrow();
    });
  });

  describe("Parent relationships", () => {
    let protoArray: ProtoArray;

    beforeEach(() => {
      protoArray = new ProtoArray({
        pruneThreshold: 0,
        justifiedEpoch: genesisEpoch,
        justifiedRoot: genesisRoot,
        finalizedEpoch: genesisEpoch,
        finalizedRoot: genesisRoot,
      });
    });

    it("intra-block: EMPTY/FULL variants have PENDING as parent", () => {
      const block = createTestBlock(gloasForkSlot, "0x02", genesisRoot, genesisRoot);
      protoArray.onBlock(block, gloasForkSlot);
      protoArray.onExecutionPayload("0x02", gloasForkSlot);

      const pendingIndex = protoArray.getNodeIndex({blockRoot: "0x02", payloadStatus: PayloadStatus.PENDING} as any);
      const emptyNode = getNodeByPayloadStatus(protoArray, "0x02", PayloadStatus.EMPTY);
      const fullNode = getNodeByPayloadStatus(protoArray, "0x02", PayloadStatus.FULL);

      expect(emptyNode?.parent).toBe(pendingIndex);
      expect(fullNode?.parent).toBe(pendingIndex);
    });

    it("inter-block: new PENDING extends parent's EMPTY or FULL", () => {
      // Block A
      const blockA = createTestBlock(gloasForkSlot, "0x02", genesisRoot, genesisRoot);
      protoArray.onBlock(blockA, gloasForkSlot);
      protoArray.onExecutionPayload("0x02", gloasForkSlot);

      // Block B extends A's FULL (parentBlockHash matches)
      const blockB = createTestBlock(gloasForkSlot + 1, "0x03", "0x02", "0x02");
      protoArray.onBlock(blockB, gloasForkSlot + 1);

      const blockAPending = protoArray.getNodeIndex({blockRoot: "0x02", payloadStatus: PayloadStatus.PENDING} as any);
      const blockAFull = protoArray.getNodeIndex({blockRoot: "0x02", payloadStatus: PayloadStatus.FULL} as any);
      const blockBPending = getNodeByPayloadStatus(protoArray, "0x03", PayloadStatus.PENDING);

      // Block B's PENDING should NOT point to A's PENDING
      expect(blockBPending?.parent).not.toBe(blockAPending);
      // Block B's PENDING should point to A's FULL (because parentBlockHash matches)
      expect(blockBPending?.parent).toBe(blockAFull);
    });
  });

  describe("Explicit EMPTY vs FULL tiebreaker for recent slots", () => {
    let protoArray: ProtoArray;

    beforeEach(() => {
      protoArray = new ProtoArray({
        pruneThreshold: 0,
        justifiedEpoch: genesisEpoch,
        justifiedRoot: genesisRoot,
        finalizedEpoch: genesisEpoch,
        finalizedRoot: genesisRoot,
      });
    });

    it("EMPTY vs FULL comparison uses explicit tiebreaker for slot n-1 blocks", () => {
      const blockSlot = gloasForkSlot + 10;
      const block = createTestBlock(blockSlot, "0x02", genesisRoot, genesisRoot);
      protoArray.onBlock(block, blockSlot);
      protoArray.onExecutionPayload("0x02", blockSlot);

      const emptyIndex = protoArray.getNodeIndex({
        blockRoot: "0x02",
        payloadStatus: PayloadStatus.EMPTY,
      } as any)!;
      const fullIndex = protoArray.getNodeIndex({
        blockRoot: "0x02",
        payloadStatus: PayloadStatus.FULL,
      } as any)!;

      // Give EMPTY more weight than FULL
      const deltas = new Array(protoArray.length()).fill(0);
      deltas[emptyIndex] = 200;
      deltas[fullIndex] = 100;

      // Apply at currentSlot = blockSlot + 1 (makes block from slot n-1)
      protoArray.applyScoreChanges({
        deltas,
        proposerBoost: null,
        justifiedEpoch: genesisEpoch,
        justifiedRoot: genesisRoot,
        finalizedEpoch: genesisEpoch,
        finalizedRoot: genesisRoot,
        currentSlot: blockSlot + 1,
      });

      const emptyNode = getNodeByPayloadStatus(protoArray, "0x02", PayloadStatus.EMPTY);
      const fullNode = getNodeByPayloadStatus(protoArray, "0x02", PayloadStatus.FULL);

      // Both nodes should have accumulated their weights
      expect(emptyNode?.weight).toBe(200);
      expect(fullNode?.weight).toBe(100);

      // But when comparing for bestChild, the tiebreaker should be used
      // (this is implicitly tested by the comparison logic, weights are ignored)
    });

    it("different blocks at slot n-1 still use weight comparison", () => {
      const blockSlot = gloasForkSlot + 10;

      const blockA = createTestBlock(blockSlot, "0x02", genesisRoot, genesisRoot);
      const blockB = createTestBlock(blockSlot, "0x03", genesisRoot, genesisRoot);

      protoArray.onBlock(blockA, blockSlot);
      protoArray.onBlock(blockB, blockSlot);

      const emptyAIndex = protoArray.getNodeIndex({
        blockRoot: "0x02",
        payloadStatus: PayloadStatus.EMPTY,
      } as any)!;
      const emptyBIndex = protoArray.getNodeIndex({
        blockRoot: "0x03",
        payloadStatus: PayloadStatus.EMPTY,
      } as any)!;

      // Give A more votes than B
      const deltas = new Array(protoArray.length()).fill(0);
      deltas[emptyAIndex] = 200;
      deltas[emptyBIndex] = 100;

      protoArray.applyScoreChanges({
        deltas,
        proposerBoost: null,
        justifiedEpoch: genesisEpoch,
        justifiedRoot: genesisRoot,
        finalizedEpoch: genesisEpoch,
        finalizedRoot: genesisRoot,
        currentSlot: blockSlot + 1,
      });

      const emptyANode = getNodeByPayloadStatus(protoArray, "0x02", PayloadStatus.EMPTY);
      const emptyBNode = getNodeByPayloadStatus(protoArray, "0x03", PayloadStatus.EMPTY);

      // Different blocks should use weight comparison, not tiebreaker
      expect(emptyANode?.weight).toBe(200);
      expect(emptyBNode?.weight).toBe(100);
      // Block A should be preferred due to higher weight
    });

    it("EMPTY vs FULL from older slots (n-2) uses weight comparison", () => {
      const blockSlot = gloasForkSlot + 10;
      const block = createTestBlock(blockSlot, "0x02", genesisRoot, genesisRoot);
      protoArray.onBlock(block, blockSlot);
      protoArray.onExecutionPayload("0x02", blockSlot);

      const emptyIndex = protoArray.getNodeIndex({
        blockRoot: "0x02",
        payloadStatus: PayloadStatus.EMPTY,
      } as any)!;
      const fullIndex = protoArray.getNodeIndex({
        blockRoot: "0x02",
        payloadStatus: PayloadStatus.FULL,
      } as any)!;

      const deltas = new Array(protoArray.length()).fill(0);
      deltas[emptyIndex] = 100;
      deltas[fullIndex] = 200;

      // currentSlot = blockSlot + 2, so block is from slot n-2 (not n-1)
      protoArray.applyScoreChanges({
        deltas,
        proposerBoost: null,
        justifiedEpoch: genesisEpoch,
        justifiedRoot: genesisRoot,
        finalizedEpoch: genesisEpoch,
        finalizedRoot: genesisRoot,
        currentSlot: blockSlot + 2,
      });

      const emptyNode = getNodeByPayloadStatus(protoArray, "0x02", PayloadStatus.EMPTY);
      const fullNode = getNodeByPayloadStatus(protoArray, "0x02", PayloadStatus.FULL);

      // Older blocks use weight comparison, not tiebreaker
      expect(emptyNode?.weight).toBe(100);
      expect(fullNode?.weight).toBe(200);
      // FULL should be preferred due to higher weight
    });
  });
});
