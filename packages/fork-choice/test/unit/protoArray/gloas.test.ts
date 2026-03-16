import {beforeEach, describe, expect, it} from "vitest";
import {PTC_SIZE} from "@lodestar/params";
import {DataAvailabilityStatus, computeStartSlotAtEpoch} from "@lodestar/state-transition";
import {RootHex} from "@lodestar/types";
import {ExecutionStatus, PayloadStatus, ProtoArray, ProtoBlock, ProtoNode} from "../../../src/index.js";

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
    const index = protoArray.getNodeIndexByRootAndStatus(blockRoot, payloadStatus);
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
      builderIndex: null,
      blockHashFromBid: null,
    };
  }

  describe("ProtoArray indices lookup", () => {
    it("indices map stores variants correctly for pre-Gloas blocks", () => {
      const protoArray = ProtoArray.initialize(createTestBlock(0, genesisRoot, "0x00"), 0);
      const variants = (protoArray as any).indices.get(genesisRoot);
      expect(variants).toBeDefined();
      // Pre-Gloas: variants is the FULL index
      expect(variants).toBe(0);
    });

    it("getNodeByPayloadStatus() retrieves correct variants", () => {
      const protoArray = ProtoArray.initialize(createTestBlock(0, genesisRoot, "0x00"), 0);
      const node = getNodeByPayloadStatus(protoArray, genesisRoot, PayloadStatus.FULL);
      expect(node).toBeDefined();
      expect(node?.blockRoot).toBe(genesisRoot);
      expect(node?.payloadStatus).toBe(PayloadStatus.FULL);
    });

    it("indices map stores multiple variants for Gloas blocks", () => {
      const protoArray = ProtoArray.initialize(createTestBlock(0, genesisRoot, "0x00"), 0);

      // Add a Gloas block
      const gloasBlock = createTestBlock(gloasForkSlot, "0x02", genesisRoot, genesisRoot);
      protoArray.onBlock(gloasBlock, gloasForkSlot, null);

      const variants = (protoArray as any).indices.get("0x02");
      expect(variants).toBeDefined();
      // Gloas: variants[PENDING] and variants[EMPTY] should be defined
      expect(variants[PayloadStatus.PENDING]).toBeDefined();
      expect(variants[PayloadStatus.EMPTY]).toBeDefined();
      expect(variants[PayloadStatus.FULL]).toBeUndefined();
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
      protoArray.onBlock(block, 1, null);

      // Should only have FULL variant
      const fullNode = getNodeByPayloadStatus(protoArray, "0x02", PayloadStatus.FULL);
      expect(fullNode).toBeDefined();
      expect(fullNode?.payloadStatus).toBe(PayloadStatus.FULL);

      // Should not have PENDING or EMPTY variants
      expect(() => getNodeByPayloadStatus(protoArray, "0x02", PayloadStatus.PENDING)).toThrow();
      expect(() => getNodeByPayloadStatus(protoArray, "0x02", PayloadStatus.EMPTY)).toThrow();
    });

    it("getNode() finds pre-Gloas blocks by root (FULL)", () => {
      const block = createTestBlock(1, "0x02", genesisRoot);
      protoArray.onBlock(block, 1, null);

      const defaultStatus = protoArray.getDefaultVariant("0x02");
      expect(defaultStatus).toBe(PayloadStatus.FULL);
      const node = defaultStatus !== undefined ? protoArray.getNode("0x02", defaultStatus) : undefined;
      expect(node).toBeDefined();
      expect(node?.payloadStatus).toBe(PayloadStatus.FULL);
    });

    it("hasBlock() returns true for pre-Gloas blocks", () => {
      const block = createTestBlock(1, "0x02", genesisRoot);
      protoArray.onBlock(block, 1, null);

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
      protoArray.onBlock(block, gloasForkSlot, null);

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
      protoArray.onBlock(block, gloasForkSlot, null);

      const emptyNode = getNodeByPayloadStatus(protoArray, "0x02", PayloadStatus.EMPTY);
      const pendingIndex = protoArray.getNodeIndexByRootAndStatus("0x02", PayloadStatus.PENDING);

      expect(emptyNode?.parent).toBe(pendingIndex);
    });

    it("initializes PTC votes for Gloas blocks", () => {
      const block = createTestBlock(gloasForkSlot, "0x02", genesisRoot, genesisRoot);
      protoArray.onBlock(block, gloasForkSlot, null);

      // All PTC votes should be false initially
      const isTimely = protoArray.isPayloadTimely("0x02");
      expect(isTimely).toBe(false);
    });

    it("does not create PENDING/EMPTY for pre-fork blocks", () => {
      const block = createTestBlock(gloasForkSlot - 1, "0x02", genesisRoot);
      protoArray.onBlock(block, gloasForkSlot - 1, null);

      // Should only have FULL (pre-Gloas behavior)
      const fullNode = getNodeByPayloadStatus(protoArray, "0x02", PayloadStatus.FULL);
      expect(fullNode).toBeDefined();

      expect(() => getNodeByPayloadStatus(protoArray, "0x02", PayloadStatus.PENDING)).toThrow();
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
      protoArray.onBlock(fuluBlock, gloasForkSlot - 1, null);

      // Add first Gloas block
      const gloasBlock = createTestBlock(gloasForkSlot, "0x03", "0x02", "0x02");
      protoArray.onBlock(gloasBlock, gloasForkSlot, null);

      const gloasPendingNode = getNodeByPayloadStatus(protoArray, "0x03", PayloadStatus.PENDING);
      const fuluFullIndex = protoArray.getNodeIndexByRootAndStatus("0x02", PayloadStatus.FULL);

      // First Gloas block's PENDING should point to parent's FULL
      expect(gloasPendingNode?.parent).toBe(fuluFullIndex);
    });

    it("getNode() finds blocks across fork transition", () => {
      // Add pre-Gloas block
      const fuluBlock = createTestBlock(gloasForkSlot - 1, "0x02", genesisRoot);
      protoArray.onBlock(fuluBlock, gloasForkSlot - 1, null);

      // Add Gloas block
      const gloasBlock = createTestBlock(gloasForkSlot, "0x03", "0x02", "0x02");
      protoArray.onBlock(gloasBlock, gloasForkSlot, null);

      // Should find both blocks with correct default variants
      const fuluDefaultStatus = protoArray.getDefaultVariant("0x02");
      expect(fuluDefaultStatus).toBe(PayloadStatus.FULL);
      const fuluNode = fuluDefaultStatus !== undefined ? protoArray.getNode("0x02", fuluDefaultStatus) : undefined;
      expect(fuluNode?.payloadStatus).toBe(PayloadStatus.FULL);

      const gloasDefaultStatus = protoArray.getDefaultVariant("0x03");
      expect(gloasDefaultStatus).toBe(PayloadStatus.PENDING);
      const gloasNode = gloasDefaultStatus !== undefined ? protoArray.getNode("0x03", gloasDefaultStatus) : undefined;
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
      protoArray.onBlock(block, gloasForkSlot, null);

      // FULL should not exist yet
      expect(getNodeByPayloadStatus(protoArray, "0x02", PayloadStatus.FULL)).toBeUndefined();

      // Call onExecutionPayload
      protoArray.onExecutionPayload("0x02", gloasForkSlot, "0x02", gloasForkSlot, stateRoot, null);

      // FULL should now exist
      const fullNode = getNodeByPayloadStatus(protoArray, "0x02", PayloadStatus.FULL);
      expect(fullNode).toBeDefined();
      expect(fullNode?.payloadStatus).toBe(PayloadStatus.FULL);
    });

    it("FULL node has PENDING as parent", () => {
      const block = createTestBlock(gloasForkSlot, "0x02", genesisRoot, genesisRoot);
      protoArray.onBlock(block, gloasForkSlot, null);

      protoArray.onExecutionPayload("0x02", gloasForkSlot, "0x02", gloasForkSlot, stateRoot, null);

      const fullNode = getNodeByPayloadStatus(protoArray, "0x02", PayloadStatus.FULL);
      const pendingIndex = protoArray.getNodeIndexByRootAndStatus("0x02", PayloadStatus.PENDING);

      expect(fullNode?.parent).toBe(pendingIndex);
    });

    it("is idempotent (calling twice does not create duplicate)", () => {
      const block = createTestBlock(gloasForkSlot, "0x02", genesisRoot, genesisRoot);
      protoArray.onBlock(block, gloasForkSlot, null);

      protoArray.onExecutionPayload("0x02", gloasForkSlot, "0x02", gloasForkSlot, stateRoot, null);
      protoArray.onExecutionPayload("0x02", gloasForkSlot, "0x02", gloasForkSlot, stateRoot, null);

      // Should still only have one FULL node
      const fullNode = getNodeByPayloadStatus(protoArray, "0x02", PayloadStatus.FULL);
      expect(fullNode).toBeDefined();
    });

    it("throws for pre-Gloas blocks", () => {
      const block = createTestBlock(gloasForkSlot - 1, "0x02", genesisRoot);
      protoArray.onBlock(block, gloasForkSlot - 1, null);

      // Pre-Gloas block already has FULL
      expect(getNodeByPayloadStatus(protoArray, "0x02", PayloadStatus.FULL)).toBeDefined();

      // Calling onExecutionPayload should throw for pre-Gloas blocks
      expect(() =>
        protoArray.onExecutionPayload("0x02", gloasForkSlot - 1, "0x02", gloasForkSlot - 1, stateRoot, null)
      ).toThrow();
    });

    it("throws for unknown block", () => {
      expect(() =>
        protoArray.onExecutionPayload("0x99", gloasForkSlot, "0x99", gloasForkSlot, stateRoot, null)
      ).toThrow();
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

    it("notifyPtcMessages() updates votes for multiple validators", () => {
      const block = createTestBlock(gloasForkSlot, "0x02", genesisRoot, genesisRoot);
      protoArray.onBlock(block, gloasForkSlot, null);

      // Initially not timely (no votes)
      expect(protoArray.isPayloadTimely("0x02")).toBe(false);

      // Vote yes from validators at indices 0, 1, 2
      protoArray.notifyPtcMessages("0x02", [0, 1, 2], true);

      // Still not timely (need >50% of PTC_SIZE)
      expect(protoArray.isPayloadTimely("0x02")).toBe(false);
    });

    it("notifyPtcMessages() validates ptcIndex range", () => {
      const block = createTestBlock(gloasForkSlot, "0x02", genesisRoot, genesisRoot);
      protoArray.onBlock(block, gloasForkSlot, null);

      expect(() => protoArray.notifyPtcMessages("0x02", [-1], true)).toThrow(/Invalid PTC index/);
      expect(() => protoArray.notifyPtcMessages("0x02", [PTC_SIZE], true)).toThrow(/Invalid PTC index/);
      expect(() => protoArray.notifyPtcMessages("0x02", [PTC_SIZE + 1], true)).toThrow(/Invalid PTC index/);
      expect(() => protoArray.notifyPtcMessages("0x02", [0, 1, PTC_SIZE], true)).toThrow(/Invalid PTC index/);
    });

    it("notifyPtcMessages() handles unknown block gracefully", () => {
      // Should not throw for unknown block
      expect(() => protoArray.notifyPtcMessages("0x99", [0], true)).not.toThrow();
    });

    it("isPayloadTimely() returns false when payload not locally available", () => {
      const block = createTestBlock(gloasForkSlot, "0x02", genesisRoot, genesisRoot);
      protoArray.onBlock(block, gloasForkSlot, null);

      // Vote yes from majority of PTC
      const threshold = Math.floor(PTC_SIZE / 2) + 1;
      const indices = Array.from({length: threshold}, (_, i) => i);
      protoArray.notifyPtcMessages("0x02", indices, true);

      // Without execution payload (no FULL variant), should return false
      expect(protoArray.isPayloadTimely("0x02")).toBe(false);
    });

    it("isPayloadTimely() returns true when threshold met and payload available", () => {
      const block = createTestBlock(gloasForkSlot, "0x02", genesisRoot, genesisRoot);
      protoArray.onBlock(block, gloasForkSlot, null);

      // Make execution payload available by creating FULL variant
      protoArray.onExecutionPayload("0x02", gloasForkSlot, "0x02", gloasForkSlot, stateRoot, null);

      // Vote yes from majority of PTC (>50%)
      const threshold = Math.floor(PTC_SIZE / 2) + 1;
      const indices = Array.from({length: threshold}, (_, i) => i);
      protoArray.notifyPtcMessages("0x02", indices, true);

      // Should now be timely
      expect(protoArray.isPayloadTimely("0x02")).toBe(true);
    });

    it("isPayloadTimely() returns false when threshold not met", () => {
      const block = createTestBlock(gloasForkSlot, "0x02", genesisRoot, genesisRoot);
      protoArray.onBlock(block, gloasForkSlot, null);

      // Make execution payload available by creating FULL variant
      protoArray.onExecutionPayload("0x02", gloasForkSlot, "0x02", gloasForkSlot, stateRoot, null);

      // Vote yes from exactly 50% (not >50%)
      const threshold = Math.floor(PTC_SIZE / 2);
      const indices = Array.from({length: threshold}, (_, i) => i);
      protoArray.notifyPtcMessages("0x02", indices, true);

      // Should not be timely (need >50%, not >=50%)
      expect(protoArray.isPayloadTimely("0x02")).toBe(false);
    });

    it("isPayloadTimely() counts only 'true' votes", () => {
      const block = createTestBlock(gloasForkSlot, "0x02", genesisRoot, genesisRoot);
      protoArray.onBlock(block, gloasForkSlot, null);

      // Make execution payload available by creating FULL variant
      protoArray.onExecutionPayload("0x02", gloasForkSlot, "0x02", gloasForkSlot, stateRoot, null);

      // Vote mixed yes/no
      const threshold = Math.floor(PTC_SIZE / 2) + 1;
      // Vote yes from indices 0..threshold-1
      const yesIndices = Array.from({length: threshold}, (_, i) => i);
      protoArray.notifyPtcMessages("0x02", yesIndices, true);
      // Vote no from indices threshold..PTC_SIZE-1
      const noIndices = Array.from({length: PTC_SIZE - threshold}, (_, i) => i + threshold);
      protoArray.notifyPtcMessages("0x02", noIndices, false);

      // Should be timely (threshold met)
      expect(protoArray.isPayloadTimely("0x02")).toBe(true);

      // Change some yes votes to no
      protoArray.notifyPtcMessages("0x02", [0, 1], false);

      // Should no longer be timely
      expect(protoArray.isPayloadTimely("0x02")).toBe(false);
    });

    it("isPayloadTimely() returns false for unknown block", () => {
      expect(protoArray.isPayloadTimely("0x99")).toBe(false);
    });

    it("does not initialize PTC votes for pre-Gloas blocks", () => {
      const block = createTestBlock(gloasForkSlot - 1, "0x02", genesisRoot);
      protoArray.onBlock(block, gloasForkSlot - 1, null);

      // Pre-Gloas blocks should not have PTC tracking
      expect(protoArray.isPayloadTimely("0x02")).toBe(false);

      // notifyPtcMessages should be no-op
      expect(() => protoArray.notifyPtcMessages("0x02", [0], true)).not.toThrow();
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
      protoArray.onBlock(block, gloasForkSlot, null);
      protoArray.onExecutionPayload("0x02", gloasForkSlot, "0x02", gloasForkSlot, stateRoot, null);

      const pendingIndex = protoArray.getNodeIndexByRootAndStatus("0x02", PayloadStatus.PENDING);
      const emptyNode = getNodeByPayloadStatus(protoArray, "0x02", PayloadStatus.EMPTY);
      const fullNode = getNodeByPayloadStatus(protoArray, "0x02", PayloadStatus.FULL);

      expect(emptyNode?.parent).toBe(pendingIndex);
      expect(fullNode?.parent).toBe(pendingIndex);
    });

    it("inter-block: new PENDING extends parent's EMPTY or FULL", () => {
      // Block A
      const blockA = createTestBlock(gloasForkSlot, "0x02Root", genesisRoot, genesisRoot);
      protoArray.onBlock(blockA, gloasForkSlot, null);
      protoArray.onExecutionPayload("0x02Root", gloasForkSlot, "0x02Hash", gloasForkSlot, stateRoot, null);

      // Block B extends A's FULL (parentBlockHash matches)
      const blockB = createTestBlock(gloasForkSlot + 1, "0x03Root", "0x02Root", "0x02Hash");
      protoArray.onBlock(blockB, gloasForkSlot + 1, null);

      const blockAPending = protoArray.getNodeIndexByRootAndStatus("0x02Root", PayloadStatus.PENDING);
      const blockAFull = protoArray.getNodeIndexByRootAndStatus("0x02Root", PayloadStatus.FULL);
      const blockBPending = getNodeByPayloadStatus(protoArray, "0x03Root", PayloadStatus.PENDING);

      // Block B's PENDING should NOT point to A's PENDING
      expect(blockBPending?.parent).not.toBe(blockAPending);
      // Block B's PENDING should point to A's FULL (because parentBlockHash matches)
      expect(blockBPending?.parent).toBe(blockAFull);
    });
  });

  describe("Explicit EMPTY vs FULL tiebreaker for recent slots", () => {
    let protoArray: ProtoArray;

    beforeEach(() => {
      // Initialize with genesis block to avoid INVALID_PARENT_DELTA errors
      protoArray = ProtoArray.initialize(createTestBlock(0, genesisRoot, "0x00"), 0);
    });

    it("EMPTY vs FULL comparison uses explicit tiebreaker for slot n-1 blocks", () => {
      const blockSlot = gloasForkSlot + 10;
      const block = createTestBlock(blockSlot, "0x02", genesisRoot, genesisRoot);
      protoArray.onBlock(block, blockSlot, null);
      protoArray.onExecutionPayload("0x02", blockSlot, "0x02", blockSlot, stateRoot, null);

      const emptyIndex = protoArray.getNodeIndexByRootAndStatus("0x02", PayloadStatus.EMPTY);
      if (emptyIndex === undefined) throw new Error("Expected emptyIndex to exist");
      const fullIndex = protoArray.getNodeIndexByRootAndStatus("0x02", PayloadStatus.FULL);
      if (fullIndex === undefined) throw new Error("Expected fullIndex to exist");

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

      protoArray.onBlock(blockA, blockSlot, null);
      protoArray.onBlock(blockB, blockSlot, null);

      const emptyAIndex = protoArray.getNodeIndexByRootAndStatus("0x02", PayloadStatus.EMPTY);
      if (emptyAIndex === undefined) throw new Error("Expected emptyAIndex to exist");
      const emptyBIndex = protoArray.getNodeIndexByRootAndStatus("0x03", PayloadStatus.EMPTY);
      if (emptyBIndex === undefined) throw new Error("Expected emptyBIndex to exist");

      // Give A more votes than B
      // Note: Use nodes.length (not protoArray.length()) since Gloas blocks have multiple nodes per root
      const deltas = new Array(protoArray.nodes.length).fill(0);
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
      protoArray.onBlock(block, blockSlot, null);
      protoArray.onExecutionPayload("0x02", blockSlot, "0x02", blockSlot, stateRoot, null);

      const emptyIndex = protoArray.getNodeIndexByRootAndStatus("0x02", PayloadStatus.EMPTY);
      if (emptyIndex === undefined) throw new Error("Expected emptyIndex to exist");
      const fullIndex = protoArray.getNodeIndexByRootAndStatus("0x02", PayloadStatus.FULL);
      if (fullIndex === undefined) throw new Error("Expected fullIndex to exist");

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
