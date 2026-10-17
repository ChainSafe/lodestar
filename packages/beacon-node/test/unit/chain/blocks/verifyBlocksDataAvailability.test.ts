import {describe, expect, it} from "vitest";
import {ForkName} from "@lodestar/params";
import {ColumnIndex, fulu, ssz} from "@lodestar/types";
import {BlockInputColumns, BlockInputSource} from "../../../../src/chain/blocks/blockInput/index.js";
import {verifyBlocksDataAvailability} from "../../../../src/chain/blocks/verifyBlocksDataAvailability.js";

const blockRootHex = "0x01";

function buildBlockInput(sampledColumns: ColumnIndex[]): BlockInputColumns {
  const block = ssz.fulu.SignedBeaconBlock.defaultValue();
  block.message.body.blobKzgCommitments = [ssz.fulu.KZGCommitment.defaultValue()];
  return BlockInputColumns.createFromBlock({
    block,
    blockRootHex,
    source: BlockInputSource.gossip,
    seenTimestampSec: Date.now() / 1000 - 1,
    forkName: ForkName.fulu,
    daOutOfRange: false,
    sampledColumns,
    custodyColumns: sampledColumns,
  });
}

function addColumn(blockInput: BlockInputColumns, index: ColumnIndex, seenTimestampSec: number): void {
  const columnSidecar: fulu.DataColumnSidecar = ssz.fulu.DataColumnSidecar.defaultValue();
  columnSidecar.index = index;
  blockInput.addColumn({blockRootHex, columnSidecar, source: BlockInputSource.gossip, seenTimestampSec});
}

describe("verifyBlocksDataAvailability", () => {
  it("returns the time data became available in Unix milliseconds", async () => {
    const blockInput = buildBlockInput([0, 1]);
    addColumn(blockInput, 0, Date.now() / 1000);

    const verified = verifyBlocksDataAvailability([blockInput], new AbortController().signal);
    const completeSec = Date.now() / 1000;
    addColumn(blockInput, 1, completeSec);
    const {availableTime} = await verified;

    expect(availableTime).toBe(completeSec * 1000);
    expect(Math.abs(Date.now() - availableTime)).toBeLessThan(1000);
  });

  it("keeps the completion time when a column arrives after the data is complete", async () => {
    const blockInput = buildBlockInput([0, 1]);
    const completeSec = Date.now() / 1000;
    addColumn(blockInput, 0, completeSec);
    addColumn(blockInput, 1, completeSec);
    addColumn(blockInput, 2, completeSec + 2);

    const {availableTime} = await verifyBlocksDataAvailability([blockInput], new AbortController().signal);

    expect(blockInput.getTimeComplete()).toBe(completeSec);
    expect(availableTime).toBe(completeSec * 1000);
  });
});
