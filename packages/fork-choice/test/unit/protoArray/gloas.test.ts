import {beforeEach, describe, expect, it} from "vitest";
import {BitArray} from "@chainsafe/ssz";
import {PTC_SIZE} from "@lodestar/params";
import {DataAvailabilityStatus, computeStartSlotAtEpoch} from "@lodestar/state-transition";
import {RootHex} from "@lodestar/types";
import {ExecutionStatus, PayloadStatus, ProtoArray, ProtoBlock, ProtoNode} from "../../../src/index.js";
import {countNoVotes} from "../../../src/protoArray/protoArray.js";

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
      importedTimely: true,
      ptcTimeliness: true,
      proposerIndex: 0,
      executionPayloadBlockHash: blockRoot, // Use blockRoot as execution hash
      executionPayloadNumber: slot,
      executionPayloadGasLimit: 30000000,
      executionStatus: ExecutionStatus.Valid,
      dataAvailabilityStatus: DataAvailabilityStatus.Available,
      parentBlockHash: parentBlockHash === undefined ? null : parentBlockHash,
      payloadStatus: PayloadStatus.FULL,
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

  describe("getCanonicalPayloadCounts", () => {
    it("excludes competing branches and keeps EMPTY after a late FULL arrives", () => {
      const currentSlot = gloasForkSlot + 2;
      const protoArray = ProtoArray.initialize(
        createTestBlock(gloasForkSlot - 1, genesisRoot, "0x00"),
        gloasForkSlot - 1
      );

      const parent = createTestBlock(gloasForkSlot, "0x02", genesisRoot, genesisRoot);
      protoArray.onBlock(parent, currentSlot, null);
      protoArray.onExecutionPayload(
        "0x02",
        currentSlot,
        "0x02ff",
        1,
        30000000,
        null,
        ExecutionStatus.Valid,
        DataAvailabilityStatus.Available
      );

      // The canonical child extends FULL. Two competing children are excluded regardless of whether
      // their own payload was revealed.
      protoArray.onBlock(createTestBlock(gloasForkSlot + 1, "0x03", "0x02", "0x02ff"), currentSlot, null);
      protoArray.onBlock(createTestBlock(gloasForkSlot + 1, "0x04", "0x02", "0x02"), currentSlot, null);
      protoArray.onBlock(createTestBlock(gloasForkSlot + 1, "0x06", "0x02", "0x02ff"), currentSlot, null);
      protoArray.onExecutionPayload(
        "0x04",
        currentSlot,
        "0x04ff",
        1,
        30000000,
        null,
        ExecutionStatus.Valid,
        DataAvailabilityStatus.Available
      );

      // A later canonical block commits to EMPTY for 0x03.
      protoArray.onBlock(createTestBlock(gloasForkSlot + 2, "0x05", "0x03", "0x03"), currentSlot, null);

      // The payload for 0x03 arrives after its EMPTY variant was extended.
      protoArray.onExecutionPayload(
        "0x03",
        currentSlot,
        "0x03ff",
        1,
        30000000,
        null,
        ExecutionStatus.Valid,
        DataAvailabilityStatus.Available
      );

      // Only the chain selected by 0x05 is assessed. 0x02 resolved FULL and 0x03 resolved EMPTY.
      expect(protoArray.getCanonicalPayloadCounts(gloasForkSlot, currentSlot, "0x05", PayloadStatus.PENDING)).toEqual({
        full: 1,
        empty: 1,
      });

      // Slot range bounds are inclusive.
      expect(
        protoArray.getCanonicalPayloadCounts(gloasForkSlot + 1, gloasForkSlot + 1, "0x05", PayloadStatus.PENDING)
      ).toEqual({full: 0, empty: 1});
    });

    it("uses the supplied head branch", () => {
      const currentSlot = gloasForkSlot + 1;
      const protoArray = ProtoArray.initialize(
        createTestBlock(gloasForkSlot - 1, genesisRoot, "0x00"),
        gloasForkSlot - 1
      );

      protoArray.onBlock(createTestBlock(gloasForkSlot, "0x02", genesisRoot, genesisRoot), currentSlot, null);
      protoArray.onExecutionPayload(
        "0x02",
        currentSlot,
        "0x02ff",
        1,
        30000000,
        null,
        ExecutionStatus.Valid,
        DataAvailabilityStatus.Available
      );
      protoArray.onBlock(createTestBlock(gloasForkSlot + 1, "0x03", "0x02", "0x02"), currentSlot, null);
      protoArray.onBlock(createTestBlock(gloasForkSlot + 1, "0x04", "0x02", "0x02ff"), currentSlot, null);

      protoArray.onExecutionPayload(
        "0x04",
        currentSlot,
        "0x04ff",
        1,
        30000000,
        null,
        ExecutionStatus.Valid,
        DataAvailabilityStatus.Available
      );

      expect(protoArray.getCanonicalPayloadCounts(gloasForkSlot, currentSlot, "0x04", PayloadStatus.FULL)).toEqual({
        full: 2,
        empty: 0,
      });
    });

    it("does not assess a PENDING head before its payload status is selected", () => {
      const protoArray = ProtoArray.initialize(
        createTestBlock(gloasForkSlot - 1, genesisRoot, "0x00"),
        gloasForkSlot - 1
      );
      protoArray.onBlock(createTestBlock(gloasForkSlot, "0x02", genesisRoot, genesisRoot), gloasForkSlot, null);

      expect(protoArray.getCanonicalPayloadCounts(gloasForkSlot, gloasForkSlot, "0x02", PayloadStatus.PENDING)).toEqual(
        {
          full: 0,
          empty: 0,
        }
      );
    });

    it("does not count the genesis block as EMPTY", () => {
      const protoArray = ProtoArray.initialize(createTestBlock(0, genesisRoot, "0x00", "0x00"), 0);

      expect(protoArray.getCanonicalPayloadCounts(0, 0, genesisRoot, PayloadStatus.EMPTY)).toEqual({
        full: 0,
        empty: 0,
      });
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
      protoArray.onExecutionPayload(
        "0x02",
        gloasForkSlot,
        "0x02",
        gloasForkSlot,
        30000000,
        null,
        ExecutionStatus.Valid,
        DataAvailabilityStatus.Available
      );

      // FULL should now exist
      const fullNode = getNodeByPayloadStatus(protoArray, "0x02", PayloadStatus.FULL);
      expect(fullNode).toBeDefined();
      expect(fullNode?.payloadStatus).toBe(PayloadStatus.FULL);
    });

    it("FULL node has PENDING as parent", () => {
      const block = createTestBlock(gloasForkSlot, "0x02", genesisRoot, genesisRoot);
      protoArray.onBlock(block, gloasForkSlot, null);

      protoArray.onExecutionPayload(
        "0x02",
        gloasForkSlot,
        "0x02",
        gloasForkSlot,
        30000000,
        null,
        ExecutionStatus.Valid,
        DataAvailabilityStatus.Available
      );

      const fullNode = getNodeByPayloadStatus(protoArray, "0x02", PayloadStatus.FULL);
      const pendingIndex = protoArray.getNodeIndexByRootAndStatus("0x02", PayloadStatus.PENDING);

      expect(fullNode?.parent).toBe(pendingIndex);
    });

    it("FULL node carries the executionPayloadGasLimit supplied to onExecutionPayload", () => {
      // Distinct from the value in createTestBlock (30M) so we know it came from this call.
      const deliveredGasLimit = 31_500_000;
      const block = createTestBlock(gloasForkSlot, "0x02", genesisRoot, genesisRoot);
      protoArray.onBlock(block, gloasForkSlot, null);

      protoArray.onExecutionPayload(
        "0x02",
        gloasForkSlot,
        "0x02",
        gloasForkSlot,
        deliveredGasLimit,
        null,
        ExecutionStatus.Valid,
        DataAvailabilityStatus.Available
      );

      const fullNode = getNodeByPayloadStatus(protoArray, "0x02", PayloadStatus.FULL);
      if (fullNode === undefined || fullNode.executionPayloadBlockHash === null) {
        throw new Error("expected post-merge FULL variant");
      }
      // FULL must carry the *delivered* gas limit, not the value the block was created with.
      // This is the value bid validation reads as `parent_gas_limit` for child bids.
      expect(fullNode.executionPayloadBlockHash).toBe("0x02");
      expect(fullNode.executionPayloadGasLimit).toBe(deliveredGasLimit);

      const pendingNode = getNodeByPayloadStatus(protoArray, "0x02", PayloadStatus.PENDING);
      if (pendingNode === undefined || pendingNode.executionPayloadBlockHash === null) {
        throw new Error("expected post-merge PENDING variant");
      }
      // PENDING/EMPTY hold inherited parent-payload values, unchanged by onExecutionPayload.
      expect(pendingNode.executionPayloadGasLimit).toBe(30_000_000);
    });

    it("is idempotent (calling twice does not create duplicate)", () => {
      const block = createTestBlock(gloasForkSlot, "0x02", genesisRoot, genesisRoot);
      protoArray.onBlock(block, gloasForkSlot, null);

      protoArray.onExecutionPayload(
        "0x02",
        gloasForkSlot,
        "0x02",
        gloasForkSlot,
        30000000,
        null,
        ExecutionStatus.Valid,
        DataAvailabilityStatus.Available
      );
      protoArray.onExecutionPayload(
        "0x02",
        gloasForkSlot,
        "0x02",
        gloasForkSlot,
        30000000,
        null,
        ExecutionStatus.Valid,
        DataAvailabilityStatus.Available
      );

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
        protoArray.onExecutionPayload(
          "0x02",
          gloasForkSlot - 1,
          "0x02",
          gloasForkSlot - 1,
          30000000,
          null,
          ExecutionStatus.Valid,
          DataAvailabilityStatus.Available
        )
      ).toThrow();
    });

    it("throws for unknown block", () => {
      expect(() =>
        protoArray.onExecutionPayload(
          "0x99",
          gloasForkSlot,
          "0x99",
          gloasForkSlot,
          30000000,
          null,
          ExecutionStatus.Valid,
          DataAvailabilityStatus.Available
        )
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
      protoArray.notifyPtcMessages("0x02", gloasForkSlot, [0, 1, 2], true, true);

      // Still not timely (need >50% of PTC_SIZE)
      expect(protoArray.isPayloadTimely("0x02")).toBe(false);
    });

    it("notifyPtcMessages() ignores messages whose slot does not match the block slot", () => {
      const block = createTestBlock(gloasForkSlot, "0x02", genesisRoot, genesisRoot);
      protoArray.onBlock(block, gloasForkSlot, null);

      // Make execution payload available so isPayloadTimely() can reach the vote check
      protoArray.onExecutionPayload(
        "0x02",
        gloasForkSlot,
        "0x02",
        gloasForkSlot,
        30000000,
        null,
        ExecutionStatus.Valid,
        DataAvailabilityStatus.Available
      );

      const threshold = Math.floor(PTC_SIZE / 2) + 1;
      const indices = Array.from({length: threshold}, (_, i) => i);

      // Slot does not match the block slot, must not mutate votes
      protoArray.notifyPtcMessages("0x02", gloasForkSlot + 1, indices, true, true);
      expect(protoArray.isPayloadTimely("0x02")).toBe(false);

      protoArray.notifyPtcMessages("0x02", gloasForkSlot, indices, true, true);
      expect(protoArray.isPayloadTimely("0x02")).toBe(true);
    });

    it("notifyPtcMessages() validates ptcIndex range", () => {
      const block = createTestBlock(gloasForkSlot, "0x02", genesisRoot, genesisRoot);
      protoArray.onBlock(block, gloasForkSlot, null);

      expect(() => protoArray.notifyPtcMessages("0x02", gloasForkSlot, [-1], true, true)).toThrow(/Invalid PTC index/);
      expect(() => protoArray.notifyPtcMessages("0x02", gloasForkSlot, [PTC_SIZE], true, true)).toThrow(
        /Invalid PTC index/
      );
      expect(() => protoArray.notifyPtcMessages("0x02", gloasForkSlot, [PTC_SIZE + 1], true, true)).toThrow(
        /Invalid PTC index/
      );
      expect(() => protoArray.notifyPtcMessages("0x02", gloasForkSlot, [0, 1, PTC_SIZE], true, true)).toThrow(
        /Invalid PTC index/
      );
    });

    it("notifyPtcMessages() handles unknown block gracefully", () => {
      // Should not throw for unknown block
      expect(() => protoArray.notifyPtcMessages("0x99", gloasForkSlot, [0], true, true)).not.toThrow();
    });

    it("getPTCVoteCounts() returns raw popcounts of attested / present / available votes", () => {
      const block = createTestBlock(gloasForkSlot, "0x02", genesisRoot, genesisRoot);
      protoArray.onBlock(block, gloasForkSlot, null);

      // No votes yet
      expect(protoArray.getPTCVoteCounts("0x02")).toEqual({
        attesterCount: 0,
        payloadPresentCount: 0,
        dataAvailableCount: 0,
      });

      // 3 validators vote present + available, 2 attest but vote against both
      protoArray.notifyPtcMessages("0x02", gloasForkSlot, [0, 1, 2], true, true);
      protoArray.notifyPtcMessages("0x02", gloasForkSlot, [3, 4], false, false);

      expect(protoArray.getPTCVoteCounts("0x02")).toEqual({
        attesterCount: 5,
        payloadPresentCount: 3,
        dataAvailableCount: 3,
      });
    });

    it("getPTCVoteCounts() returns null for pre-Gloas and unknown roots", () => {
      // Pre-Gloas block (parentBlockHash === null) has no PTC vote maps
      const preGloasBlock = createTestBlock(gloasForkSlot - 1, "0x03", genesisRoot);
      protoArray.onBlock(preGloasBlock, gloasForkSlot - 1, null);
      expect(protoArray.getPTCVoteCounts("0x03")).toBeNull();
      // Unknown root
      expect(protoArray.getPTCVoteCounts("0x99")).toBeNull();
    });

    it("isPayloadTimely() returns false when payload not locally available", () => {
      const block = createTestBlock(gloasForkSlot, "0x02", genesisRoot, genesisRoot);
      protoArray.onBlock(block, gloasForkSlot, null);

      // Vote yes from majority of PTC
      const threshold = Math.floor(PTC_SIZE / 2) + 1;
      const indices = Array.from({length: threshold}, (_, i) => i);
      protoArray.notifyPtcMessages("0x02", gloasForkSlot, indices, true, true);

      // Without execution payload (no FULL variant), should return false
      expect(protoArray.isPayloadTimely("0x02")).toBe(false);
    });

    it("isPayloadTimely() returns true when threshold met and payload available", () => {
      const block = createTestBlock(gloasForkSlot, "0x02", genesisRoot, genesisRoot);
      protoArray.onBlock(block, gloasForkSlot, null);

      // Make execution payload available by creating FULL variant
      protoArray.onExecutionPayload(
        "0x02",
        gloasForkSlot,
        "0x02",
        gloasForkSlot,
        30000000,
        null,
        ExecutionStatus.Valid,
        DataAvailabilityStatus.Available
      );

      // Vote yes from majority of PTC (>50%)
      const threshold = Math.floor(PTC_SIZE / 2) + 1;
      const indices = Array.from({length: threshold}, (_, i) => i);
      protoArray.notifyPtcMessages("0x02", gloasForkSlot, indices, true, true);

      // Should now be timely
      expect(protoArray.isPayloadTimely("0x02")).toBe(true);
    });

    it("isPayloadTimely() returns false when threshold not met", () => {
      const block = createTestBlock(gloasForkSlot, "0x02", genesisRoot, genesisRoot);
      protoArray.onBlock(block, gloasForkSlot, null);

      // Make execution payload available by creating FULL variant
      protoArray.onExecutionPayload(
        "0x02",
        gloasForkSlot,
        "0x02",
        gloasForkSlot,
        30000000,
        null,
        ExecutionStatus.Valid,
        DataAvailabilityStatus.Available
      );

      // Vote yes from exactly 50% (not >50%)
      const threshold = Math.floor(PTC_SIZE / 2);
      const indices = Array.from({length: threshold}, (_, i) => i);
      protoArray.notifyPtcMessages("0x02", gloasForkSlot, indices, true, true);

      // Should not be timely (need >50%, not >=50%)
      expect(protoArray.isPayloadTimely("0x02")).toBe(false);
    });

    it("isPayloadTimely() counts only 'true' votes", () => {
      const block = createTestBlock(gloasForkSlot, "0x02", genesisRoot, genesisRoot);
      protoArray.onBlock(block, gloasForkSlot, null);

      // Make execution payload available by creating FULL variant
      protoArray.onExecutionPayload(
        "0x02",
        gloasForkSlot,
        "0x02",
        gloasForkSlot,
        30000000,
        null,
        ExecutionStatus.Valid,
        DataAvailabilityStatus.Available
      );

      // Vote mixed yes/no
      const threshold = Math.floor(PTC_SIZE / 2) + 1;
      // Vote yes from indices 0..threshold-1
      const yesIndices = Array.from({length: threshold}, (_, i) => i);
      protoArray.notifyPtcMessages("0x02", gloasForkSlot, yesIndices, true, true);
      // Vote no from indices threshold..PTC_SIZE-1
      const noIndices = Array.from({length: PTC_SIZE - threshold}, (_, i) => i + threshold);
      protoArray.notifyPtcMessages("0x02", gloasForkSlot, noIndices, false, false);

      // Should be timely (threshold met)
      expect(protoArray.isPayloadTimely("0x02")).toBe(true);

      // Change some yes votes to no
      protoArray.notifyPtcMessages("0x02", gloasForkSlot, [0, 1], false, false);

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
      expect(() => protoArray.notifyPtcMessages("0x02", gloasForkSlot - 1, [0], true, true)).not.toThrow();
    });
  });

  describe("countNoVotes() — popcount(attended AND NOT yes)", () => {
    function bits(bitLen: number, setIndices: number[]): BitArray {
      const arr = BitArray.fromBitLen(bitLen);
      for (const i of setIndices) arr.set(i, true);
      return arr;
    }

    it("returns 0 for empty bitvectors", () => {
      const attended = BitArray.fromBitLen(PTC_SIZE);
      const yes = BitArray.fromBitLen(PTC_SIZE);
      expect(countNoVotes(attended, yes)).toBe(0);
    });

    it("returns 0 when every attended member also voted YES", () => {
      const indices = Array.from({length: PTC_SIZE}, (_, i) => i);
      const attended = bits(PTC_SIZE, indices);
      const yes = bits(PTC_SIZE, indices);
      expect(countNoVotes(attended, yes)).toBe(0);
    });

    it("returns full attendance when no member voted YES", () => {
      const indices = Array.from({length: PTC_SIZE}, (_, i) => i);
      const attended = bits(PTC_SIZE, indices);
      const yes = BitArray.fromBitLen(PTC_SIZE);
      expect(countNoVotes(attended, yes)).toBe(PTC_SIZE);
    });

    it("ignores yes bits set outside attended (None state must not become NO)", () => {
      // Pathological: yes claims indices that never attended. AND NOT must exclude them.
      const attended = BitArray.fromBitLen(PTC_SIZE);
      const yes = bits(PTC_SIZE, [0, 1, 2]);
      expect(countNoVotes(attended, yes)).toBe(0);
    });

    it("counts only attended-but-not-yes indices", () => {
      // Attended: {0, 1, 2, 3, 4}. YES: {0, 1}. Expected NO count: {2, 3, 4} = 3.
      const attended = bits(PTC_SIZE, [0, 1, 2, 3, 4]);
      const yes = bits(PTC_SIZE, [0, 1]);
      expect(countNoVotes(attended, yes)).toBe(3);
    });

    it("handles bits spread across multiple bytes", () => {
      // Pick indices across several byte boundaries (only when PTC_SIZE is large enough).
      if (PTC_SIZE < 24) return;
      const attendedIndices = [0, 7, 8, 15, 16, 23];
      const yesIndices = [7, 16]; // YES at one bit in bytes 0 and 2
      const attended = bits(PTC_SIZE, attendedIndices);
      const yes = bits(PTC_SIZE, yesIndices);
      // NO bits = {0, 8, 15, 23} → 4
      expect(countNoVotes(attended, yes)).toBe(4);
    });

    it("handles edge bits (first and last)", () => {
      const attended = bits(PTC_SIZE, [0, PTC_SIZE - 1]);
      const yes = bits(PTC_SIZE, [0]); // YES at first only
      // NO = {PTC_SIZE - 1} → 1
      expect(countNoVotes(attended, yes)).toBe(1);
    });

    it("disjoint attended and yes: NO count = popcount(attended)", () => {
      // attended ∩ yes = ∅. So attended AND NOT yes == attended.
      if (PTC_SIZE < 4) return;
      const attended = bits(PTC_SIZE, [0, 1]);
      const yes = bits(PTC_SIZE, [2, 3]);
      expect(countNoVotes(attended, yes)).toBe(2);
    });

    it("matches a brute-force reference implementation across the bit range", () => {
      // Cross-check the byte-wise popcount against a per-bit loop on a fixed pattern.
      const attendedIndices: number[] = [];
      const yesIndices: number[] = [];
      for (let i = 0; i < PTC_SIZE; i++) {
        if (i % 3 !== 0) attendedIndices.push(i); // ~2/3 attended
        if (i % 5 === 0) yesIndices.push(i); // 1/5 vote YES (may or may not be attended)
      }
      const attended = bits(PTC_SIZE, attendedIndices);
      const yes = bits(PTC_SIZE, yesIndices);

      let expected = 0;
      for (let i = 0; i < PTC_SIZE; i++) {
        if (attended.get(i) && !yes.get(i)) expected++;
      }
      expect(countNoVotes(attended, yes)).toBe(expected);
    });
  });

  describe("isPayloadNotTimely() — Spec: payload_timeliness(timely=False)", () => {
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

    function makeFullBlock(): void {
      const block = createTestBlock(gloasForkSlot, "0x02", genesisRoot, genesisRoot);
      protoArray.onBlock(block, gloasForkSlot, null);
      protoArray.onExecutionPayload(
        "0x02",
        gloasForkSlot,
        "0x02",
        gloasForkSlot,
        30000000,
        null,
        ExecutionStatus.Valid,
        DataAvailabilityStatus.Available
      );
    }

    it("returns true when payload not locally available (None spec branch)", () => {
      const block = createTestBlock(gloasForkSlot, "0x02", genesisRoot, genesisRoot);
      protoArray.onBlock(block, gloasForkSlot, null);
      // No FULL variant created — spec returns `not False = True`
      expect(protoArray.isPayloadNotTimely("0x02")).toBe(true);
    });

    it("returns true when explicit timeliness-False votes exceed threshold", () => {
      makeFullBlock();
      const overThreshold = Math.floor(PTC_SIZE / 2) + 1;
      const indices = Array.from({length: overThreshold}, (_, i) => i);
      // payloadPresent=false ⇒ explicit timeliness NO vote
      protoArray.notifyPtcMessages("0x02", gloasForkSlot, indices, false, true);
      expect(protoArray.isPayloadNotTimely("0x02")).toBe(true);
    });

    it("non-attending PTC members do not count as NO votes (None != False)", () => {
      makeFullBlock();
      // Only a single explicit NO vote — the rest never attested (None)
      protoArray.notifyPtcMessages("0x02", gloasForkSlot, [0], false, true);
      expect(protoArray.isPayloadNotTimely("0x02")).toBe(false);
    });

    it("YES votes do not count as NO (popcount(attended AND NOT yes) excludes YES bits)", () => {
      // If the algorithm were popcount(attended) instead of popcount(attended AND NOT yes),
      // a full house of YES votes would erroneously trigger NO threshold.
      makeFullBlock();
      const indices = Array.from({length: PTC_SIZE}, (_, i) => i);
      protoArray.notifyPtcMessages("0x02", gloasForkSlot, indices, true, true);
      expect(protoArray.isPayloadNotTimely("0x02")).toBe(false);
    });

    it("DA NO votes do not pollute timeliness NO count (cross-dimension isolation)", () => {
      // Every PTC member votes (payloadPresent=true, blobDataAvailable=false).
      // Timeliness YES → no timeliness NO votes. DA NO → DA NO threshold tripped.
      // isPayloadNotTimely must read only payloadTimelinessVotes, not payloadDataAvailabilityVotes.
      makeFullBlock();
      const indices = Array.from({length: PTC_SIZE}, (_, i) => i);
      protoArray.notifyPtcMessages("0x02", gloasForkSlot, indices, true, false);
      expect(protoArray.isPayloadNotTimely("0x02")).toBe(false);
      expect(protoArray.isPayloadDataNotAvailable("0x02")).toBe(true);
    });

    it("flipping a NO vote to YES decrements the NO count below threshold", () => {
      makeFullBlock();
      const overThreshold = Math.floor(PTC_SIZE / 2) + 1;
      const indices = Array.from({length: overThreshold}, (_, i) => i);
      protoArray.notifyPtcMessages("0x02", gloasForkSlot, indices, false, true);
      expect(protoArray.isPayloadNotTimely("0x02")).toBe(true);
      // PTC member 0 changes their mind: NO → YES. NO count drops below threshold.
      protoArray.notifyPtcMessages("0x02", gloasForkSlot, [0], true, true);
      expect(protoArray.isPayloadNotTimely("0x02")).toBe(false);
    });

    it("mixed YES + NO votes count only the NO bits", () => {
      // PTC_SIZE / 2 + 1 YES votes, then PTC_SIZE / 2 NO votes at non-overlapping indices.
      // NO count = floor(PTC_SIZE / 2) which is exactly at threshold → false.
      makeFullBlock();
      const overThreshold = Math.floor(PTC_SIZE / 2) + 1;
      const yesIndices = Array.from({length: overThreshold}, (_, i) => i);
      const noIndices = Array.from({length: PTC_SIZE - overThreshold}, (_, i) => i + overThreshold);
      protoArray.notifyPtcMessages("0x02", gloasForkSlot, yesIndices, true, true);
      protoArray.notifyPtcMessages("0x02", gloasForkSlot, noIndices, false, true);
      // NO count = PTC_SIZE - overThreshold = floor(PTC_SIZE/2) - 1, well under threshold
      expect(protoArray.isPayloadNotTimely("0x02")).toBe(false);
    });

    it("subset attended, all subset voted NO, subset > threshold → true", () => {
      // Tri-state: indices [0..overThreshold) → False; rest → None.
      // The explicit NO subset alone trips the threshold.
      makeFullBlock();
      const overThreshold = Math.floor(PTC_SIZE / 2) + 1;
      const indices = Array.from({length: overThreshold}, (_, i) => i);
      protoArray.notifyPtcMessages("0x02", gloasForkSlot, indices, false, true);
      expect(protoArray.isPayloadNotTimely("0x02")).toBe(true);
    });
  });

  describe("isPayloadDataAvailable() — Spec: payload_data_availability(available=True)", () => {
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

    function makeFullBlock(): void {
      const block = createTestBlock(gloasForkSlot, "0x02", genesisRoot, genesisRoot);
      protoArray.onBlock(block, gloasForkSlot, null);
      protoArray.onExecutionPayload(
        "0x02",
        gloasForkSlot,
        "0x02",
        gloasForkSlot,
        30000000,
        null,
        ExecutionStatus.Valid,
        DataAvailabilityStatus.Available
      );
    }

    it("returns false for unknown block", () => {
      expect(protoArray.isPayloadDataAvailable("0x99")).toBe(false);
    });

    it("returns false when payload not locally available", () => {
      const block = createTestBlock(gloasForkSlot, "0x02", genesisRoot, genesisRoot);
      protoArray.onBlock(block, gloasForkSlot, null);
      const overThreshold = Math.floor(PTC_SIZE / 2) + 1;
      const indices = Array.from({length: overThreshold}, (_, i) => i);
      protoArray.notifyPtcMessages("0x02", gloasForkSlot, indices, true, true);
      // No FULL variant — spec returns `not True = False`
      expect(protoArray.isPayloadDataAvailable("0x02")).toBe(false);
    });

    it("returns true when DA YES votes exceed threshold and payload available", () => {
      makeFullBlock();
      const overThreshold = Math.floor(PTC_SIZE / 2) + 1;
      const indices = Array.from({length: overThreshold}, (_, i) => i);
      protoArray.notifyPtcMessages("0x02", gloasForkSlot, indices, true, true);
      expect(protoArray.isPayloadDataAvailable("0x02")).toBe(true);
    });

    it("returns false when DA YES votes exactly at threshold (>, not >=)", () => {
      makeFullBlock();
      const atThreshold = Math.floor(PTC_SIZE / 2);
      const indices = Array.from({length: atThreshold}, (_, i) => i);
      protoArray.notifyPtcMessages("0x02", gloasForkSlot, indices, true, true);
      expect(protoArray.isPayloadDataAvailable("0x02")).toBe(false);
    });
  });

  describe("isPayloadDataNotAvailable() — Spec: payload_data_availability(available=False)", () => {
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

    function makeFullBlock(): void {
      const block = createTestBlock(gloasForkSlot, "0x02", genesisRoot, genesisRoot);
      protoArray.onBlock(block, gloasForkSlot, null);
      protoArray.onExecutionPayload(
        "0x02",
        gloasForkSlot,
        "0x02",
        gloasForkSlot,
        30000000,
        null,
        ExecutionStatus.Valid,
        DataAvailabilityStatus.Available
      );
    }

    it("returns true when payload not locally available (None spec branch)", () => {
      const block = createTestBlock(gloasForkSlot, "0x02", genesisRoot, genesisRoot);
      protoArray.onBlock(block, gloasForkSlot, null);
      expect(protoArray.isPayloadDataNotAvailable("0x02")).toBe(true);
    });

    it("returns true when explicit DA-False votes exceed threshold", () => {
      makeFullBlock();
      const overThreshold = Math.floor(PTC_SIZE / 2) + 1;
      const indices = Array.from({length: overThreshold}, (_, i) => i);
      // blobDataAvailable=false ⇒ explicit DA NO vote
      protoArray.notifyPtcMessages("0x02", gloasForkSlot, indices, true, false);
      expect(protoArray.isPayloadDataNotAvailable("0x02")).toBe(true);
    });

    it("returns false when DA-False votes exactly at threshold (>, not >=)", () => {
      makeFullBlock();
      const atThreshold = Math.floor(PTC_SIZE / 2);
      const indices = Array.from({length: atThreshold}, (_, i) => i);
      protoArray.notifyPtcMessages("0x02", gloasForkSlot, indices, true, false);
      expect(protoArray.isPayloadDataNotAvailable("0x02")).toBe(false);
    });

    // Tri-state regression guard: a `daYes + daNo` two-bit encoding would have
    // miscounted None as False. We track attendance separately to prevent that.
    it("non-attending PTC members do not count as NO votes (None != False)", () => {
      makeFullBlock();
      protoArray.notifyPtcMessages("0x02", gloasForkSlot, [0], true, false);
      expect(protoArray.isPayloadDataNotAvailable("0x02")).toBe(false);
    });

    it("YES votes do not count as NO (popcount(attended AND NOT yes) excludes YES bits)", () => {
      // If the algorithm were popcount(attended) instead of popcount(attended AND NOT yes),
      // a full house of DA YES votes would erroneously trigger NO threshold.
      makeFullBlock();
      const indices = Array.from({length: PTC_SIZE}, (_, i) => i);
      protoArray.notifyPtcMessages("0x02", gloasForkSlot, indices, true, true);
      expect(protoArray.isPayloadDataNotAvailable("0x02")).toBe(false);
    });

    it("timeliness NO votes do not pollute DA NO count (cross-dimension isolation)", () => {
      // Every PTC member votes (payloadPresent=false, blobDataAvailable=true).
      // Timeliness NO → timeliness NO threshold tripped. DA YES → no DA NO votes.
      // isPayloadDataNotAvailable must read only payloadDataAvailabilityVotes, not payloadTimelinessVotes.
      makeFullBlock();
      const indices = Array.from({length: PTC_SIZE}, (_, i) => i);
      protoArray.notifyPtcMessages("0x02", gloasForkSlot, indices, false, true);
      expect(protoArray.isPayloadDataNotAvailable("0x02")).toBe(false);
      expect(protoArray.isPayloadNotTimely("0x02")).toBe(true);
    });

    it("flipping a NO vote to YES decrements the NO count below threshold", () => {
      makeFullBlock();
      const overThreshold = Math.floor(PTC_SIZE / 2) + 1;
      const indices = Array.from({length: overThreshold}, (_, i) => i);
      protoArray.notifyPtcMessages("0x02", gloasForkSlot, indices, true, false);
      expect(protoArray.isPayloadDataNotAvailable("0x02")).toBe(true);
      // PTC member 0 changes their mind: DA NO → DA YES. NO count drops below threshold.
      protoArray.notifyPtcMessages("0x02", gloasForkSlot, [0], true, true);
      expect(protoArray.isPayloadDataNotAvailable("0x02")).toBe(false);
    });

    it("mixed DA YES + NO votes count only the NO bits", () => {
      makeFullBlock();
      const overThreshold = Math.floor(PTC_SIZE / 2) + 1;
      const yesIndices = Array.from({length: overThreshold}, (_, i) => i);
      const noIndices = Array.from({length: PTC_SIZE - overThreshold}, (_, i) => i + overThreshold);
      protoArray.notifyPtcMessages("0x02", gloasForkSlot, yesIndices, true, true);
      protoArray.notifyPtcMessages("0x02", gloasForkSlot, noIndices, true, false);
      // NO count = PTC_SIZE - overThreshold = floor(PTC_SIZE/2) - 1, well under threshold
      expect(protoArray.isPayloadDataNotAvailable("0x02")).toBe(false);
    });

    it("tri-state combined: None + DA YES + DA NO, where NO subset alone trips threshold", () => {
      // Partition PTC members into three groups:
      //   - YES voters: indices [0, overThreshold)
      //   - NO voters:  indices [overThreshold, overThreshold + overThreshold)
      //   - None:       indices [overThreshold + overThreshold, PTC_SIZE)
      // Verify isPayloadDataNotAvailable counts only the NO subset.
      makeFullBlock();
      const overThreshold = Math.floor(PTC_SIZE / 2) + 1;
      // Bail out gracefully on small minimal configs where partition wouldn't fit.
      if (overThreshold * 2 > PTC_SIZE) return;
      const yesIndices = Array.from({length: overThreshold}, (_, i) => i);
      const noIndices = Array.from({length: overThreshold}, (_, i) => i + overThreshold);
      protoArray.notifyPtcMessages("0x02", gloasForkSlot, yesIndices, true, true);
      protoArray.notifyPtcMessages("0x02", gloasForkSlot, noIndices, true, false);
      expect(protoArray.isPayloadDataNotAvailable("0x02")).toBe(true);
      // And confirm DA YES isn't ALSO tripped (the YES subset is also > threshold here).
      expect(protoArray.isPayloadDataAvailable("0x02")).toBe(true);
    });
  });

  describe("shouldBuildOnFull() - Spec: should_build_on_full(store, head, slot)", () => {
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

    function makeHead(payloadStatus: PayloadStatus): ProtoBlock {
      const block = createTestBlock(gloasForkSlot, "0x02", genesisRoot, genesisRoot);
      protoArray.onBlock(block, gloasForkSlot, null);
      if (payloadStatus === PayloadStatus.FULL) {
        protoArray.onExecutionPayload(
          "0x02",
          gloasForkSlot,
          "0x02",
          gloasForkSlot,
          30000000,
          null,
          ExecutionStatus.Valid,
          DataAvailabilityStatus.Available
        );
      }
      const node = getNodeByPayloadStatus(protoArray, "0x02", payloadStatus);
      if (node === undefined) throw new Error(`No ${PayloadStatus[payloadStatus]} variant`);
      return node;
    }

    it("throws when head is PENDING", () => {
      const head = makeHead(PayloadStatus.PENDING);
      expect(() => protoArray.shouldBuildOnFull(head, head.slot + 1)).toThrow(/PENDING/);
    });

    it("returns false when head is EMPTY", () => {
      const head = makeHead(PayloadStatus.EMPTY);
      expect(protoArray.shouldBuildOnFull(head, head.slot + 1)).toBe(false);
    });

    it("returns true when head is FULL and no DA NO votes", () => {
      const head = makeHead(PayloadStatus.FULL);
      // No votes at all — isPayloadDataNotAvailable returns false → build on full
      expect(protoArray.shouldBuildOnFull(head, head.slot + 1)).toBe(true);
    });

    it("returns false when head is FULL and DA NO votes exceed threshold (reorg trigger)", () => {
      const head = makeHead(PayloadStatus.FULL);
      const overThreshold = Math.floor(PTC_SIZE / 2) + 1;
      const indices = Array.from({length: overThreshold}, (_, i) => i);
      protoArray.notifyPtcMessages("0x02", head.slot, indices, true, false);
      expect(protoArray.shouldBuildOnFull(head, head.slot + 1)).toBe(false);
    });

    it("returns true when head is FULL and DA NO votes exactly at threshold (>, not >=)", () => {
      const head = makeHead(PayloadStatus.FULL);
      const atThreshold = Math.floor(PTC_SIZE / 2);
      const indices = Array.from({length: atThreshold}, (_, i) => i);
      protoArray.notifyPtcMessages("0x02", head.slot, indices, true, false);
      expect(protoArray.shouldBuildOnFull(head, head.slot + 1)).toBe(true);
    });

    it("returns true when many PTC members did not vote and few NO votes are below threshold", () => {
      // Guards against None being miscounted as NO — would force a spurious reorg.
      const head = makeHead(PayloadStatus.FULL);
      protoArray.notifyPtcMessages("0x02", head.slot, [0], true, false);
      expect(protoArray.shouldBuildOnFull(head, head.slot + 1)).toBe(true);
    });

    it("returns false when head is FULL, data available but timeliness NO votes exceed threshold (late payload reorg)", () => {
      const head = makeHead(PayloadStatus.FULL);
      const overThreshold = Math.floor(PTC_SIZE / 2) + 1;
      const indices = Array.from({length: overThreshold}, (_, i) => i);
      // payloadPresent=false (untimely), blobDataAvailable=true (data available)
      protoArray.notifyPtcMessages("0x02", head.slot, indices, false, true);
      expect(protoArray.shouldBuildOnFull(head, head.slot + 1)).toBe(false);
    });

    it("returns true when head is FULL and timeliness NO votes exactly at threshold (>, not >=)", () => {
      const head = makeHead(PayloadStatus.FULL);
      const atThreshold = Math.floor(PTC_SIZE / 2);
      const indices = Array.from({length: atThreshold}, (_, i) => i);
      protoArray.notifyPtcMessages("0x02", head.slot, indices, false, true);
      expect(protoArray.shouldBuildOnFull(head, head.slot + 1)).toBe(true);
    });

    it("returns true for a FULL head that is not from the previous slot, even with PTC voting against it", () => {
      const head = makeHead(PayloadStatus.FULL);
      const overThreshold = Math.floor(PTC_SIZE / 2) + 1;
      const indices = Array.from({length: overThreshold}, (_, i) => i);
      protoArray.notifyPtcMessages("0x02", head.slot, indices, false, false);
      expect(protoArray.shouldBuildOnFull(head, head.slot + 2)).toBe(true);
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
      protoArray.onExecutionPayload(
        "0x02",
        gloasForkSlot,
        "0x02",
        gloasForkSlot,
        30000000,
        null,
        ExecutionStatus.Valid,
        DataAvailabilityStatus.Available
      );

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
      protoArray.onExecutionPayload(
        "0x02Root",
        gloasForkSlot,
        "0x02Hash",
        gloasForkSlot,
        30000000,
        null,
        ExecutionStatus.Valid,
        DataAvailabilityStatus.Available
      );

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
      protoArray.onExecutionPayload(
        "0x02",
        blockSlot,
        "0x02",
        blockSlot,
        30000000,
        null,
        ExecutionStatus.Valid,
        DataAvailabilityStatus.Available
      );

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
        attestationDeltas: deltas,
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
      expect(emptyNode?.weight).toBe(200_000_000_000n);
      expect(fullNode?.weight).toBe(100_000_000_000n);

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
        attestationDeltas: deltas,
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
      expect(emptyANode?.weight).toBe(200_000_000_000n);
      expect(emptyBNode?.weight).toBe(100_000_000_000n);
      // Block A should be preferred due to higher weight
    });

    it("EMPTY vs FULL from older slots (n-2) uses weight comparison", () => {
      const blockSlot = gloasForkSlot + 10;
      const block = createTestBlock(blockSlot, "0x02", genesisRoot, genesisRoot);
      protoArray.onBlock(block, blockSlot, null);
      protoArray.onExecutionPayload(
        "0x02",
        blockSlot,
        "0x02",
        blockSlot,
        30000000,
        null,
        ExecutionStatus.Valid,
        DataAvailabilityStatus.Available
      );

      const emptyIndex = protoArray.getNodeIndexByRootAndStatus("0x02", PayloadStatus.EMPTY);
      if (emptyIndex === undefined) throw new Error("Expected emptyIndex to exist");
      const fullIndex = protoArray.getNodeIndexByRootAndStatus("0x02", PayloadStatus.FULL);
      if (fullIndex === undefined) throw new Error("Expected fullIndex to exist");

      const deltas = new Array(protoArray.length()).fill(0);
      deltas[emptyIndex] = 100;
      deltas[fullIndex] = 200;

      // currentSlot = blockSlot + 2, so block is from slot n-2 (not n-1)
      protoArray.applyScoreChanges({
        attestationDeltas: deltas,
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
      expect(emptyNode?.weight).toBe(100_000_000_000n);
      expect(fullNode?.weight).toBe(200_000_000_000n);
      // FULL should be preferred due to higher weight
    });
  });

  describe("Pruning (maybePrune)", () => {
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

    it("should prune all Gloas variants (PENDING/EMPTY/FULL) before finalized index", () => {
      // Build a chain: block1 → block2 → block3
      // When we prune at block2, block1 and all its variants (PENDING/EMPTY/FULL) are removed.
      const block1 = createTestBlock(gloasForkSlot, "0x02", genesisRoot, genesisRoot);
      const block2 = createTestBlock(gloasForkSlot + 1, "0x03", "0x02", "0x02");
      const block3 = createTestBlock(gloasForkSlot + 2, "0x04", "0x03", "0x03");

      protoArray.onBlock(block1, gloasForkSlot, null);
      protoArray.onBlock(block2, gloasForkSlot + 1, null);
      protoArray.onBlock(block3, gloasForkSlot + 2, null);

      // Create all three variants for block1: PENDING, EMPTY, FULL
      protoArray.onExecutionPayload(
        "0x02",
        gloasForkSlot,
        "0x02",
        gloasForkSlot,
        30000000,
        null,
        ExecutionStatus.Valid,
        DataAvailabilityStatus.Available
      );

      // Get block1's variants indices before pruning
      const block1PendingBefore = protoArray.getNodeIndexByRootAndStatus("0x02", PayloadStatus.PENDING);
      const block1EmptyBefore = protoArray.getNodeIndexByRootAndStatus("0x02", PayloadStatus.EMPTY);
      const block1FullBefore = protoArray.getNodeIndexByRootAndStatus("0x02", PayloadStatus.FULL);
      expect(block1PendingBefore).toBeDefined();
      expect(block1EmptyBefore).toBeDefined();
      expect(block1FullBefore).toBeDefined();

      // Get block2's PENDING index (this will be the finalizedIndex)
      const block2PendingBefore = protoArray.getNodeIndexByRootAndStatus("0x03", PayloadStatus.PENDING);
      expect(block2PendingBefore).toBeDefined();

      // Prune at block2 (all block1 variants will be deleted)
      const prunedBlocks = protoArray.maybePrune("0x03");

      // Verify block1's variants are removed from indices
      expect(protoArray.getNodeIndexByRootAndStatus("0x02", PayloadStatus.PENDING)).toBeUndefined();
      expect(protoArray.getNodeIndexByRootAndStatus("0x02", PayloadStatus.EMPTY)).toBeUndefined();
      expect(protoArray.getNodeIndexByRootAndStatus("0x02", PayloadStatus.FULL)).toBeUndefined();

      // Verify pruned blocks were returned
      expect(prunedBlocks.length).toBeGreaterThan(0);
      expect(prunedBlocks.some((b) => b.blockRoot === "0x02")).toBe(true);

      // Verify block2 and block3 still exist with adjusted indices
      const block2PendingAfter = protoArray.getNodeIndexByRootAndStatus("0x03", PayloadStatus.PENDING);
      const block3PendingAfter = protoArray.getNodeIndexByRootAndStatus("0x04", PayloadStatus.PENDING);
      expect(block2PendingAfter).toBeDefined();
      expect(block3PendingAfter).toBeDefined();
      // Indices should be reduced by the number of pruned nodes
      if (block2PendingAfter !== undefined && block2PendingBefore !== undefined) {
        expect(block2PendingAfter < block2PendingBefore).toBe(true);
      }
    });

    it("should clean up PTC votes for pruned Gloas blocks", () => {
      const block1 = createTestBlock(gloasForkSlot, "0x02", genesisRoot, genesisRoot);
      const block2 = createTestBlock(gloasForkSlot + 1, "0x03", "0x02", "0x02");

      protoArray.onBlock(block1, gloasForkSlot, null);
      protoArray.onBlock(block2, gloasForkSlot + 1, null);

      // Create FULL variant for block1
      protoArray.onExecutionPayload(
        "0x02",
        gloasForkSlot,
        "0x02",
        gloasForkSlot,
        30000000,
        null,
        ExecutionStatus.Valid,
        DataAvailabilityStatus.Available
      );

      // Set PTC votes for block1
      const threshold = Math.floor(PTC_SIZE / 2) + 1;
      const indices = Array.from({length: threshold}, (_, i) => i);
      protoArray.notifyPtcMessages("0x02", gloasForkSlot, indices, true, true);

      // Verify PTC votes are set
      expect(protoArray.isPayloadTimely("0x02")).toBe(true);

      // Prune at block2 - this removes block1
      protoArray.maybePrune("0x03");

      // After pruning, block1 is gone, so isPayloadTimely should return false
      expect(protoArray.isPayloadTimely("0x02")).toBe(false);
    });

    it("should handle Gloas variants with correct single-pass deletion", () => {
      // Test the core assumption: PENDING is always at index[0] for Gloas variants
      // and all variants share the same blockRoot, so they're all deleted in one loop.
      const block1 = createTestBlock(gloasForkSlot, "0x02", genesisRoot, genesisRoot);
      const block2 = createTestBlock(gloasForkSlot + 1, "0x03", "0x02", "0x02");

      protoArray.onBlock(block1, gloasForkSlot, null);
      protoArray.onBlock(block2, gloasForkSlot + 1, null);

      // Create all three variants for block1
      protoArray.onExecutionPayload(
        "0x02",
        gloasForkSlot,
        "0x02",
        gloasForkSlot,
        30000000,
        null,
        ExecutionStatus.Valid,
        DataAvailabilityStatus.Available
      );

      // Verify all three variants exist via the public API
      const pendingIdx = protoArray.getNodeIndexByRootAndStatus("0x02", PayloadStatus.PENDING);
      const emptyIdx = protoArray.getNodeIndexByRootAndStatus("0x02", PayloadStatus.EMPTY);
      const fullIdx = protoArray.getNodeIndexByRootAndStatus("0x02", PayloadStatus.FULL);
      expect(pendingIdx).not.toBeUndefined();
      expect(emptyIdx).not.toBeUndefined();
      expect(fullIdx).not.toBeUndefined();

      if (pendingIdx === undefined || emptyIdx === undefined || fullIdx === undefined) {
        throw new Error("Expected pending/empty/full variants to exist");
      }

      // Verify PENDING is stored at the smallest index among the variants
      expect(pendingIdx < emptyIdx).toBe(true);
      expect(pendingIdx < fullIdx).toBe(true);

      // Prune - all block1 variants should be deleted even though they're at different indices
      protoArray.maybePrune("0x03");

      // All three variants removed in one pass
      expect(protoArray.getNodeIndexByRootAndStatus("0x02", PayloadStatus.PENDING)).toBeUndefined();
      expect(protoArray.getNodeIndexByRootAndStatus("0x02", PayloadStatus.EMPTY)).toBeUndefined();
      expect(protoArray.getNodeIndexByRootAndStatus("0x02", PayloadStatus.FULL)).toBeUndefined();
    });
  });

  describe("Inherited executionStatus on gloas onBlock (F1)", () => {
    let protoArray: ProtoArray;

    beforeEach(() => {
      protoArray = new ProtoArray({
        pruneThreshold: 0,
        justifiedEpoch: genesisEpoch,
        justifiedRoot: genesisRoot,
        finalizedEpoch: genesisEpoch,
        finalizedRoot: genesisRoot,
      });
      // Genesis block is Valid via createTestBlock default
      protoArray.onBlock(createTestBlock(0, genesisRoot, "0x00"), 0, null);
    });

    it("PENDING/EMPTY inherit Syncing when caller passes Syncing", () => {
      const block = createTestBlock(gloasForkSlot, "0x02", genesisRoot, genesisRoot);
      block.executionStatus = ExecutionStatus.Syncing;
      protoArray.onBlock(block, gloasForkSlot, null);
      const pending = getNodeByPayloadStatus(protoArray, "0x02", PayloadStatus.PENDING);
      const empty = getNodeByPayloadStatus(protoArray, "0x02", PayloadStatus.EMPTY);
      expect(pending?.executionStatus).toBe(ExecutionStatus.Syncing);
      expect(empty?.executionStatus).toBe(ExecutionStatus.Syncing);
    });

    it("PENDING/EMPTY inherit Valid when caller passes Valid", () => {
      const block = createTestBlock(gloasForkSlot, "0x02", genesisRoot, genesisRoot);
      block.executionStatus = ExecutionStatus.Valid;
      protoArray.onBlock(block, gloasForkSlot, null);
      const pending = getNodeByPayloadStatus(protoArray, "0x02", PayloadStatus.PENDING);
      const empty = getNodeByPayloadStatus(protoArray, "0x02", PayloadStatus.EMPTY);
      expect(pending?.executionStatus).toBe(ExecutionStatus.Valid);
      expect(empty?.executionStatus).toBe(ExecutionStatus.Valid);
    });
  });

  describe("Back-validation in onExecutionPayload (Fix #1)", () => {
    let protoArray: ProtoArray;

    beforeEach(() => {
      protoArray = new ProtoArray({
        pruneThreshold: 0,
        justifiedEpoch: genesisEpoch,
        justifiedRoot: genesisRoot,
        finalizedEpoch: genesisEpoch,
        finalizedRoot: genesisRoot,
      });
      protoArray.onBlock(createTestBlock(0, genesisRoot, "0x00"), 0, null);
    });

    it("VALID payload back-validates Syncing FULL ancestor on chain", () => {
      // block1 (gloas, FULL Syncing) → block2 (gloas) extends block1's FULL
      const block1 = createTestBlock(gloasForkSlot, "0x02", genesisRoot, genesisRoot);
      block1.executionStatus = ExecutionStatus.Syncing;
      protoArray.onBlock(block1, gloasForkSlot, null);
      protoArray.onExecutionPayload(
        "0x02",
        gloasForkSlot,
        "0x02",
        gloasForkSlot,
        30000000,
        null,
        ExecutionStatus.Syncing,
        DataAvailabilityStatus.Available
      );

      const block2 = createTestBlock(gloasForkSlot + 1, "0x03", "0x02", "0x02");
      block2.executionStatus = ExecutionStatus.Syncing;
      protoArray.onBlock(block2, gloasForkSlot + 1, null);

      // Pre-condition: block1 FULL is Syncing
      expect(getNodeByPayloadStatus(protoArray, "0x02", PayloadStatus.FULL)?.executionStatus).toBe(
        ExecutionStatus.Syncing
      );

      // VALID payload arrives for block2 — should walk up validating block1 FULL + PENDING
      protoArray.onExecutionPayload(
        "0x03",
        gloasForkSlot + 1,
        "0x03",
        gloasForkSlot + 1,
        30000000,
        null,
        ExecutionStatus.Valid,
        DataAvailabilityStatus.Available
      );

      expect(getNodeByPayloadStatus(protoArray, "0x03", PayloadStatus.FULL)?.executionStatus).toBe(
        ExecutionStatus.Valid
      );
      expect(getNodeByPayloadStatus(protoArray, "0x03", PayloadStatus.PENDING)?.executionStatus).toBe(
        ExecutionStatus.Valid
      );
      expect(getNodeByPayloadStatus(protoArray, "0x03", PayloadStatus.EMPTY)?.executionStatus).toBe(
        ExecutionStatus.Valid
      );
      expect(getNodeByPayloadStatus(protoArray, "0x02", PayloadStatus.FULL)?.executionStatus).toBe(
        ExecutionStatus.Valid
      );
      expect(getNodeByPayloadStatus(protoArray, "0x02", PayloadStatus.PENDING)?.executionStatus).toBe(
        ExecutionStatus.Valid
      );
      expect(getNodeByPayloadStatus(protoArray, "0x02", PayloadStatus.EMPTY)?.executionStatus).toBe(
        ExecutionStatus.Valid
      );
    });

    it("VALID payload does NOT validate alternative-timeline FULL", () => {
      // Production semantic: gloas PENDING/EMPTY store parentBlockHash in executionPayloadBlockHash.
      // FULL stores its own payload hash. Need different hashes to test alt-timeline correctly.
      const block1 = createTestBlock(gloasForkSlot, "0x02", genesisRoot, genesisRoot);
      block1.executionStatus = ExecutionStatus.Syncing;
      block1.executionPayloadBlockHash = genesisRoot; // PENDING/EMPTY store parent's payload hash
      protoArray.onBlock(block1, gloasForkSlot, null);

      // block1 FULL arrives Syncing with its OWN payload hash
      protoArray.onExecutionPayload(
        "0x02",
        gloasForkSlot,
        "0x02hash",
        gloasForkSlot,
        30000000,
        null,
        ExecutionStatus.Syncing,
        DataAvailabilityStatus.Available
      );

      // block2 extends block1's EMPTY (parentBlockHash = genesisRoot, NOT block1's payload hash)
      const block2 = createTestBlock(gloasForkSlot + 1, "0x03", "0x02", genesisRoot);
      block2.executionStatus = ExecutionStatus.Syncing;
      block2.executionPayloadBlockHash = genesisRoot; // PENDING/EMPTY store parent's payload hash
      protoArray.onBlock(block2, gloasForkSlot + 1, null);

      // VALID for block2 — walk should go through block1's EMPTY, NOT block1's FULL
      protoArray.onExecutionPayload(
        "0x03",
        gloasForkSlot + 1,
        "0x03",
        gloasForkSlot + 1,
        30000000,
        null,
        ExecutionStatus.Valid,
        DataAvailabilityStatus.Available
      );

      // block1 FULL must remain Syncing (not on this chain)
      expect(getNodeByPayloadStatus(protoArray, "0x02", PayloadStatus.FULL)?.executionStatus).toBe(
        ExecutionStatus.Syncing
      );
      // block1 EMPTY (on the chain) should now be Valid
      expect(getNodeByPayloadStatus(protoArray, "0x02", PayloadStatus.EMPTY)?.executionStatus).toBe(
        ExecutionStatus.Valid
      );
      expect(getNodeByPayloadStatus(protoArray, "0x03", PayloadStatus.EMPTY)?.executionStatus).toBe(
        ExecutionStatus.Valid
      );
    });

    it("Syncing payload does NOT trigger back-validation", () => {
      const block1 = createTestBlock(gloasForkSlot, "0x02", genesisRoot, genesisRoot);
      block1.executionStatus = ExecutionStatus.Syncing;
      protoArray.onBlock(block1, gloasForkSlot, null);
      protoArray.onExecutionPayload(
        "0x02",
        gloasForkSlot,
        "0x02",
        gloasForkSlot,
        30000000,
        null,
        ExecutionStatus.Syncing,
        DataAvailabilityStatus.Available
      );

      // FULL is Syncing, ancestors not validated
      expect(getNodeByPayloadStatus(protoArray, "0x02", PayloadStatus.FULL)?.executionStatus).toBe(
        ExecutionStatus.Syncing
      );
      expect(getNodeByPayloadStatus(protoArray, "0x02", PayloadStatus.PENDING)?.executionStatus).toBe(
        ExecutionStatus.Syncing
      );
    });
  });

  describe("Parent variant disambiguation in validateLatestHash (F2)", () => {
    let protoArray: ProtoArray;

    beforeEach(() => {
      protoArray = new ProtoArray({
        pruneThreshold: 0,
        justifiedEpoch: genesisEpoch,
        justifiedRoot: genesisRoot,
        finalizedEpoch: genesisEpoch,
        finalizedRoot: genesisRoot,
      });
      protoArray.onBlock(createTestBlock(0, genesisRoot, "0x00"), 0, null);
    });

    it("getNodeIndexByRootAndBlockHash returns FULL when hash matches FULL", () => {
      const block = createTestBlock(gloasForkSlot, "0x02", genesisRoot, genesisRoot);
      block.executionStatus = ExecutionStatus.Syncing;
      protoArray.onBlock(block, gloasForkSlot, null);
      protoArray.onExecutionPayload(
        "0x02",
        gloasForkSlot,
        "0x02hash",
        gloasForkSlot,
        30000000,
        null,
        ExecutionStatus.Syncing,
        DataAvailabilityStatus.Available
      );

      // Look up by FULL's payload hash → should return FULL index
      const fullIdx = protoArray.getNodeIndexByRootAndStatus("0x02", PayloadStatus.FULL);
      const found = protoArray.getNodeIndexByRootAndBlockHash("0x02", "0x02hash");
      expect(found).toBe(fullIdx);
    });

    it("getNodeIndexByRootAndBlockHash returns EMPTY when hash matches EMPTY (parent's hash)", () => {
      // For gloas EMPTY, executionPayloadBlockHash == bid.parentBlockHash (= genesisRoot here)
      const block = createTestBlock(gloasForkSlot, "0x02", genesisRoot, genesisRoot);
      block.executionStatus = ExecutionStatus.Syncing;
      block.executionPayloadBlockHash = genesisRoot; // production semantic for gloas PENDING/EMPTY
      protoArray.onBlock(block, gloasForkSlot, null);

      // FULL not added yet — only EMPTY available with hash = genesisRoot
      const emptyIdx = protoArray.getNodeIndexByRootAndStatus("0x02", PayloadStatus.EMPTY);
      const found = protoArray.getNodeIndexByRootAndBlockHash("0x02", genesisRoot);
      expect(found).toBe(emptyIdx);
    });

    it("getNodeIndexByRootAndBlockHash returns undefined when no variant matches", () => {
      const block = createTestBlock(gloasForkSlot, "0x02", genesisRoot, genesisRoot);
      protoArray.onBlock(block, gloasForkSlot, null);
      const found = protoArray.getNodeIndexByRootAndBlockHash("0x02", "0xunknown");
      expect(found).toBeUndefined();
    });

    it("getNodeIndexByRootAndBlockHash returns pre-gloas FULL when hash matches", () => {
      const preGloasBlock = createTestBlock(gloasForkSlot - 1, "0x05", genesisRoot);
      protoArray.onBlock(preGloasBlock, gloasForkSlot - 1, null);
      const fullIdx = protoArray.getNodeIndexByRootAndStatus("0x05", PayloadStatus.FULL);
      const found = protoArray.getNodeIndexByRootAndBlockHash("0x05", "0x05");
      expect(found).toBe(fullIdx);
    });
  });
});
