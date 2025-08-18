import {beforeEach, describe, expect, it} from "vitest";
import {
  ChainAdvanceResult,
  ChainState,
  DownloadState,
  Header,
  LinkedBackwardsChain,
  UnknownAncestorBackwardsChain,
  UnknownHeadBackwardsChain,
  addAncestorHeader,
  addHeadHeader,
  advanceChain,
  linkChain,
  mergeChain,
} from "../../../../src/sync/unknownChain/backwardsChain.js";

describe("sync / unknownChain / backwardsChain", () => {
  // Test data helpers
  const createHeader = (slot: number, root: string, parentRoot: string): Header => ({
    slot,
    root: root as any,
    parentRoot: parentRoot as any,
  });

  const createUnknownHeadChain = (headRoot: string): UnknownHeadBackwardsChain => ({
    state: ChainState.UnknownHead,
    downloadState: DownloadState.Idle,
    headRoot: headRoot as any,
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
    headRoot: headRoot as any,
    head,
    earliestKnownAncestor: earliestKnownAncestor as any,
    ancestors: new Map(),
    peers: new Set(["peer1"]),
    lastUpdate: Date.now(),
  });

  const createLinkedChain = (headRoot: string, head: Header, forwardChain: Header[]): LinkedBackwardsChain => ({
    state: ChainState.Linked,
    downloadState: DownloadState.Idle,
    headRoot: headRoot as any,
    head,
    forwardChain,
    ancestors: new Map(),
    peers: new Set(["peer1"]),
    lastUpdate: Date.now(),
  });

  describe("addHeadHeader", () => {
    let chain: UnknownHeadBackwardsChain;
    let header: Header;

    beforeEach(() => {
      chain = createUnknownHeadChain("0x1234");
      header = createHeader(100, "0x1234", "0x4567");
    });

    it("should advance chain when header root matches head root", () => {
      const result = addHeadHeader(chain, header);

      expect(result).toBe(ChainAdvanceResult.Advanced);
      expect((chain as any).state).toBe(ChainState.UnknownAncestor);
      expect((chain as any).head).toEqual(header);
      expect((chain as any).lastUpdate).toBeGreaterThan(0);
    });

    it("should not advance chain when header root does not match head root", () => {
      const wrongHeader = createHeader(100, "0x999", "0x4567");
      const result = addHeadHeader(chain, wrongHeader);

      expect(result).toBe(ChainAdvanceResult.NotAdvanced);
      expect(chain.state).toBe(ChainState.UnknownHead);
      expect((chain as any).head).toBeUndefined();
    });

    it("should update lastUpdate timestamp when advancing", () => {
      const originalTime = chain.lastUpdate;
      // Small delay to ensure timestamp difference
      setTimeout(() => {
        const result = addHeadHeader(chain, header);
        expect(result).toBe(ChainAdvanceResult.Advanced);
        expect((chain as any).lastUpdate).toBeGreaterThan(originalTime);
      }, 1);
    });
  });

  describe("addAncestorHeader", () => {
    let chain: UnknownAncestorBackwardsChain;
    let header: Header;

    beforeEach(() => {
      const headHeader = createHeader(100, "0x1234", "0x4567");
      chain = createUnknownAncestorChain("0x1234", headHeader, "0x4567");
      header = createHeader(99, "0x4567", "0x7890");
    });

    it("should advance chain when header root matches earliest known ancestor", () => {
      const result = addAncestorHeader(chain, header);

      expect(result).toBe(ChainAdvanceResult.Advanced);
      expect(chain.ancestors.get("0x4567")).toEqual(header);
      expect(chain.earliestKnownAncestor).toBe("0x7890");
      expect(chain.lastUpdate).toBeGreaterThan(0);
    });

    it("should not advance chain when header root does not match earliest known ancestor", () => {
      const wrongHeader = createHeader(99, "0x999", "0x7890");
      const result = addAncestorHeader(chain, wrongHeader);

      expect(result).toBe(ChainAdvanceResult.NotAdvanced);
      expect(chain.ancestors.size).toBe(0);
      expect(chain.earliestKnownAncestor).toBe("0x4567");
    });

    it("should update lastUpdate timestamp when advancing", () => {
      const originalTime = chain.lastUpdate;
      setTimeout(() => {
        const result = addAncestorHeader(chain, header);
        expect(result).toBe(ChainAdvanceResult.Advanced);
        expect(chain.lastUpdate).toBeGreaterThan(originalTime);
      }, 1);
    });
  });

  describe("advanceChain", () => {
    it("should not advance linked chain", () => {
      const headHeader = createHeader(100, "0x1234", "0x4567");
      const chain = createLinkedChain("0x1234", headHeader, [headHeader]);
      const header = createHeader(99, "0x4567", "0x7890");

      const result = advanceChain(chain, header);

      expect(result).toBe(ChainAdvanceResult.NotAdvanced);
    });

    it("should call addAncestorHeader for UnknownAncestor chain", () => {
      const headHeader = createHeader(100, "0x1234", "0x4567");
      const chain = createUnknownAncestorChain("0x1234", headHeader, "0x4567");
      const header = createHeader(99, "0x4567", "0x7890");

      const result = advanceChain(chain, header);

      expect(result).toBe(ChainAdvanceResult.Advanced);
      expect(chain.ancestors.get("0x4567")).toEqual(header);
      expect(chain.earliestKnownAncestor).toBe("0x7890");
    });

    it("should call addHeadHeader for UnknownHead chain", () => {
      const chain = createUnknownHeadChain("0x1234");
      const header = createHeader(100, "0x1234", "0x4567");

      const result = advanceChain(chain, header);

      expect(result).toBe(ChainAdvanceResult.Advanced);
      expect((chain as any).state).toBe(ChainState.UnknownAncestor);
      expect((chain as any).head).toEqual(header);
    });
  });

  describe("mergeChain", () => {
    let chain: UnknownAncestorBackwardsChain;
    let otherChain: UnknownAncestorBackwardsChain;

    beforeEach(() => {
      const headHeader = createHeader(100, "0x1234", "0x4567");
      chain = createUnknownAncestorChain("0x1234", headHeader, "0x4567");

      const otherHeadHeader = createHeader(99, "0x4567", "0x7890");
      otherChain = createUnknownAncestorChain("0x4567", otherHeadHeader, "0x7890");
      otherChain.ancestors.set("0x4567", otherHeadHeader);
      otherChain.peers.add("peer2");
    });

    it("should throw error when chains cannot be merged", () => {
      const invalidOtherChain = createUnknownAncestorChain("0x999", createHeader(99, "0x999", "0x7890"), "0x7890");

      expect(() => mergeChain(chain, invalidOtherChain)).toThrow(
        "Cannot merge chains, earliestKnownAncestor does not match headRoot"
      );
    });

    it("should merge UnknownAncestor chain into current chain", () => {
      const originalAncestorsSize = chain.ancestors.size;

      mergeChain(chain, otherChain);

      // Both chains start with "peer1", so we expect peer1 (original) + peer2 (from otherChain)
      expect(chain.peers.size).toBe(2); // peer1 (original) + peer2 (from otherChain)
      expect(chain.peers.has("peer1")).toBe(true);
      expect(chain.peers.has("peer2")).toBe(true);
      expect(chain.ancestors.size).toBe(originalAncestorsSize + otherChain.ancestors.size);
      expect(chain.earliestKnownAncestor).toBe(otherChain.earliestKnownAncestor);
      expect(chain.lastUpdate).toBeGreaterThan(0);
    });

    it("should merge Linked chain into current chain", () => {
      const linkedOtherChain = createLinkedChain("0x4567", createHeader(99, "0x4567", "0x7890"), [
        createHeader(99, "0x4567", "0x7890"),
        createHeader(98, "0x7890", "0xabcd"),
      ]);
      linkedOtherChain.peers.add("peer3");
      linkedOtherChain.ancestors.set("0x4567", createHeader(99, "0x4567", "0x7890"));

      mergeChain(chain, linkedOtherChain);

      expect((chain as any).state).toBe(ChainState.Linked);
      expect(chain.peers.has("peer3")).toBe(true);
      expect((chain as any).forwardChain).toBeDefined();
      expect((chain as any).forwardChain.length).toBeGreaterThan(0);
    });

    it("should update lastUpdate timestamp", () => {
      const originalTime = chain.lastUpdate;
      setTimeout(() => {
        mergeChain(chain, otherChain);
        expect(chain.lastUpdate).toBeGreaterThan(originalTime);
      }, 1);
    });
  });

  describe("linkChain", () => {
    let chain: UnknownAncestorBackwardsChain;

    beforeEach(() => {
      const headHeader = createHeader(100, "0x1234", "0x4567");
      chain = createUnknownAncestorChain("0x1234", headHeader, "0x7890");

      // Add some ancestors to create a chain
      const ancestor1 = createHeader(99, "0x4567", "0x7890");
      const ancestor2 = createHeader(98, "0x7890", "0xabcd");
      chain.ancestors.set("0x4567", ancestor1);
      chain.ancestors.set("0x7890", ancestor2);
    });

    it("should convert UnknownAncestor chain to Linked chain", () => {
      const linkedChain = linkChain(chain);

      expect(linkedChain.state).toBe(ChainState.Linked);
      expect(linkedChain.forwardChain).toBeDefined();
      expect(linkedChain.forwardChain.length).toBeGreaterThan(0);
      expect(linkedChain.forwardChain[0]).toEqual(chain.head);
      expect(linkedChain.lastUpdate).toBeGreaterThan(0);
    });

    it("should create correct forward chain order", () => {
      const linkedChain = linkChain(chain);

      expect(linkedChain.forwardChain.length).toBe(3); // head + 2 ancestors
      expect(linkedChain.forwardChain[0].slot).toBe(100); // head
      expect(linkedChain.forwardChain[1].slot).toBe(99); // first ancestor
      expect(linkedChain.forwardChain[2].slot).toBe(98); // second ancestor
    });

    it("should handle chain with no ancestors", () => {
      const simpleChain = createUnknownAncestorChain("0x1234", createHeader(100, "0x1234", "0x4567"), "0x4567");
      const linkedChain = linkChain(simpleChain);

      expect(linkedChain.forwardChain.length).toBe(1);
      expect(linkedChain.forwardChain[0]).toEqual(simpleChain.head);
    });

    it("should handle broken chain (missing ancestor)", () => {
      // Remove one ancestor to create a gap
      chain.ancestors.delete("0x7890");
      const linkedChain = linkChain(chain);

      expect(linkedChain.forwardChain.length).toBe(2); // head + first ancestor only
      expect(linkedChain.forwardChain[0].slot).toBe(100);
      expect(linkedChain.forwardChain[1].slot).toBe(99);
    });

    it("should update lastUpdate timestamp", () => {
      const originalTime = chain.lastUpdate;
      setTimeout(() => {
        const linkedChain = linkChain(chain);
        expect(linkedChain.lastUpdate).toBeGreaterThan(originalTime);
      }, 1);
    });
  });

  describe("Chain state transitions", () => {
    it("should transition from UnknownHead to UnknownAncestor", () => {
      const chain = createUnknownHeadChain("0x1234");
      const header = createHeader(100, "0x1234", "0x4567");

      expect(chain.state).toBe(ChainState.UnknownHead);

      const result = addHeadHeader(chain, header);

      expect(result).toBe(ChainAdvanceResult.Advanced);
      expect((chain as any).state).toBe(ChainState.UnknownAncestor);
    });

    it("should transition from UnknownAncestor to Linked", () => {
      const headHeader = createHeader(100, "0x1234", "0x4567");
      const chain = createUnknownAncestorChain("0x1234", headHeader, "0x4567");

      expect(chain.state).toBe(ChainState.UnknownAncestor);

      const linkedChain = linkChain(chain);

      expect(linkedChain.state).toBe(ChainState.Linked);
    });
  });

  describe("Edge cases", () => {
    it("should handle empty ancestors map in linkChain", () => {
      const headHeader = createHeader(100, "0x1234", "0x4567");
      const chain = createUnknownAncestorChain("0x1234", headHeader, "0x4567");

      const linkedChain = linkChain(chain);

      expect(linkedChain.forwardChain.length).toBe(1);
      expect(linkedChain.forwardChain[0]).toEqual(headHeader);
    });

    it("should handle peer set operations correctly", () => {
      const headHeader = createHeader(100, "0x1234", "0x4567");
      const chain = createUnknownAncestorChain("0x1234", headHeader, "0x4567");
      const otherChain = createUnknownAncestorChain("0x4567", createHeader(99, "0x4567", "0x7890"), "0x7890");

      chain.peers.add("peer1");
      chain.peers.add("peer2");
      otherChain.peers.add("peer2"); // duplicate
      otherChain.peers.add("peer3");

      mergeChain(chain, otherChain);

      expect(chain.peers.size).toBe(3); // peer1, peer2, peer3 (no duplicates)
      expect(chain.peers.has("peer1")).toBe(true);
      expect(chain.peers.has("peer2")).toBe(true);
      expect(chain.peers.has("peer3")).toBe(true);
    });

    it("should handle ancestor map operations correctly", () => {
      const headHeader = createHeader(100, "0x1234", "0x4567");
      const chain = createUnknownAncestorChain("0x1234", headHeader, "0x4567");
      const otherChain = createUnknownAncestorChain("0x4567", createHeader(99, "0x4567", "0x7890"), "0x7890");

      const ancestor1 = createHeader(99, "0x4567", "0x7890");
      const ancestor2 = createHeader(98, "0x7890", "0xabcd");

      chain.ancestors.set("existing", ancestor1);
      otherChain.ancestors.set("0x4567", ancestor1);
      otherChain.ancestors.set("0x7890", ancestor2);

      mergeChain(chain, otherChain);

      expect(chain.ancestors.size).toBe(3);
      expect(chain.ancestors.has("existing")).toBe(true);
      expect(chain.ancestors.has("0x4567")).toBe(true);
      expect(chain.ancestors.has("0x7890")).toBe(true);
    });
  });
});
