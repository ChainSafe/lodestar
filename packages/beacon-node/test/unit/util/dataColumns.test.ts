import {describe, expect, it} from "vitest";
import {ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {
  computePartialMessageGroupId,
  dataColumnToPartialSidecar,
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

describe("dataColumnToPartialSidecar", () => {
  it("can build a header-only partial sidecar", () => {
    const sidecar = ssz.fulu.DataColumnSidecar.defaultValue();
    sidecar.column = [new Uint8Array(32)];
    sidecar.kzgCommitments = [new Uint8Array(48)];
    sidecar.kzgProofs = [new Uint8Array(48)];

    const partialSidecar = dataColumnToPartialSidecar(sidecar, {
      includeHeader: true,
      includeCells: false,
    });

    expect(partialSidecar.header).toHaveLength(1);
    expect(partialSidecar.cellsPresentBitmap).toEqual([]);
    expect(partialSidecar.partialColumn).toEqual([]);
    expect(partialSidecar.kzgProofs).toEqual([]);
  });

  it("can build a full partial sidecar with all cells present", () => {
    const sidecar = ssz.fulu.DataColumnSidecar.defaultValue();
    sidecar.column = [new Uint8Array(32)];
    sidecar.kzgCommitments = [new Uint8Array(48)];
    sidecar.kzgProofs = [new Uint8Array(48)];

    const partialSidecar = dataColumnToPartialSidecar(sidecar, {
      includeHeader: true,
      includeCells: true,
    });

    expect(partialSidecar.header).toHaveLength(1);
    expect(partialSidecar.cellsPresentBitmap).toEqual([true]);
    expect(partialSidecar.partialColumn).toEqual(sidecar.column);
    expect(partialSidecar.kzgProofs).toEqual(sidecar.kzgProofs);
  });
});
