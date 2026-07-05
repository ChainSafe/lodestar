import {describe, expect, it, vi} from "vitest";
import {ForkSeq} from "@lodestar/params";
import {IBlockInput} from "../../../../src/chain/blocks/blockInput/types.js";
import {MissingDependencyDeps, classifyMissingDependency} from "../../../../src/sync/utils/missingDependency.js";

const PARENT = "0xparent";
const SELF = "0xself";
// Distinct EL block hashes; the second byte differs so toRootHex outputs differ.
const PARENT_BLOCK_HASH = new Uint8Array(32).fill(1);

/** Build deps with controllable fork-choice / seen-cache probes. */
function makeDeps(opts: {
  forkSeq?: ForkSeq;
  hasBlockHex?: boolean;
  blockWithPayload?: boolean;
  hasPayloadHexUnsafe?: boolean;
  seenInput?: {getBlockHashHex(): string} | undefined;
}): MissingDependencyDeps {
  return {
    config: {getForkSeq: vi.fn(() => opts.forkSeq ?? ForkSeq.gloas)} as unknown as MissingDependencyDeps["config"],
    chain: {
      forkChoice: {
        hasBlockHex: vi.fn(() => opts.hasBlockHex ?? true),
        getBlockHexAndBlockHash: vi.fn(() => (opts.blockWithPayload ? ({} as never) : null)),
        hasPayloadHexUnsafe: vi.fn(() => opts.hasPayloadHexUnsafe ?? false),
      },
      seenPayloadEnvelopeInputCache: {get: vi.fn(() => opts.seenInput)},
    } as unknown as MissingDependencyDeps["chain"],
  };
}

/** Build a gloas block input whose bid carries `PARENT_BLOCK_HASH`. */
function makeBlockInput(hasBlock = true): IBlockInput {
  return {
    parentRootHex: PARENT,
    blockRootHex: SELF,
    slot: 100,
    hasBlock: vi.fn(() => hasBlock),
    getBlock: vi.fn(() => ({
      message: {body: {signedExecutionPayloadBid: {message: {parentBlockHash: PARENT_BLOCK_HASH}}}},
    })),
  } as unknown as IBlockInput;
}

describe("classifyMissingDependency", () => {
  it("parentBlock: parent not in fork choice", () => {
    const dep = classifyMissingDependency(makeDeps({hasBlockHex: false}), makeBlockInput());
    expect(dep).toEqual({kind: "parentBlock", rootHex: PARENT});
  });

  it("block: parent known but the block itself is not yet downloaded", () => {
    const dep = classifyMissingDependency(makeDeps({}), makeBlockInput(false));
    expect(dep).toEqual({kind: "block", rootHex: SELF});
  });

  it("ready: pre-gloas block needs no payload lineage", () => {
    const dep = classifyMissingDependency(makeDeps({forkSeq: ForkSeq.fulu}), makeBlockInput());
    expect(dep).toEqual({kind: "ready"});
  });

  it("ready: gloas parent's payload is already in fork choice", () => {
    const dep = classifyMissingDependency(makeDeps({blockWithPayload: true}), makeBlockInput());
    expect(dep).toEqual({kind: "ready"});
  });

  it("parentPayload: gloas parent payload missing and not seen", () => {
    const dep = classifyMissingDependency(makeDeps({seenInput: undefined}), makeBlockInput());
    expect(dep).toEqual({kind: "parentPayload", rootHex: PARENT});
  });

  it("invalidParentPayload: fork choice already has a conflicting parent payload", () => {
    const dep = classifyMissingDependency(makeDeps({hasPayloadHexUnsafe: true}), makeBlockInput());
    expect(dep).toMatchObject({kind: "invalidParentPayload", parentRootHex: PARENT});
  });

  it("invalidParentPayload: seen payload's block hash contradicts the bid", () => {
    const seenInput = {getBlockHashHex: () => "0xdifferent"};
    const dep = classifyMissingDependency(makeDeps({seenInput}), makeBlockInput());
    expect(dep).toMatchObject({kind: "invalidParentPayload", parentRootHex: PARENT});
  });
});
