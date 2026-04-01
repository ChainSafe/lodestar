import {describe, expect, it} from "vitest";
import {toRootHex} from "@lodestar/utils";
import {
  computePartialMessageGroupId,
  getBlockRootHexFromPartialMessageGroupId,
} from "../../../src/util/dataColumns.js";

describe("partial message group ID helpers", () => {
  it("round-trips the block root through the group ID", () => {
    const blockRoot = new Uint8Array(32);
    blockRoot[0] = 1;
    blockRoot[31] = 255;

    const groupId = computePartialMessageGroupId(blockRoot);

    expect(getBlockRootHexFromPartialMessageGroupId(groupId)).toBe(toRootHex(blockRoot));
  });

  it("returns null for an unsupported version byte", () => {
    const blockRoot = new Uint8Array(32);
    const groupId = computePartialMessageGroupId(blockRoot);
    groupId[0] = 1;

    expect(getBlockRootHexFromPartialMessageGroupId(groupId)).toBeNull();
  });

  it("returns null for an invalid group ID length", () => {
    expect(getBlockRootHexFromPartialMessageGroupId(new Uint8Array(16))).toBeNull();
  });
});
