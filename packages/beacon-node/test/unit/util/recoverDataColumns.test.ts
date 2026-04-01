import {afterEach, describe, expect, it, vi} from "vitest";
import {NUMBER_OF_COLUMNS} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {BlockInputSource} from "../../../src/chain/blocks/blockInput/index.js";
import {ChainEvent, ChainEventEmitter, PublishDataColumnsEventData} from "../../../src/chain/emitter.js";
import {DataColumnReconstructionCode, recoverDataColumnSidecars} from "../../../src/util/dataColumns.js";

const {dataColumnMatrixRecoveryMock} = vi.hoisted(() => ({
  dataColumnMatrixRecoveryMock: vi.fn(),
}));

vi.mock("../../../src/util/blobs.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/util/blobs.js")>();
  return {
    ...actual,
    dataColumnMatrixRecovery: dataColumnMatrixRecoveryMock,
  };
});

function createSidecar(index: number) {
  const sidecar = ssz.fulu.DataColumnSidecar.defaultValue();
  sidecar.index = index;
  sidecar.signedBlockHeader.message.slot = 1;
  return sidecar;
}

describe("recoverDataColumnSidecars", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("should publish recovered columns through the unified data-column event with a recovery trigger", async () => {
    const emitter = new ChainEventEmitter();
    const published: PublishDataColumnsEventData[] = [];
    emitter.on(ChainEvent.publishDataColumns, (data) => published.push(data));

    const existingColumns = Array.from({length: NUMBER_OF_COLUMNS / 2}, (_value, index) => createSidecar(index));
    const recoveredColumn = createSidecar(NUMBER_OF_COLUMNS / 2);
    const blockInput = {
      blockRootHex: "0x" + "22".repeat(32),
      getAllColumns: vi.fn(() => existingColumns),
      hasColumn: vi.fn((index: number) => index < existingColumns.length),
      addColumn: vi.fn(),
    };

    dataColumnMatrixRecoveryMock.mockImplementation(async (partialSidecars: Map<number, unknown>) => {
      expect(partialSidecars.size).toBe(NUMBER_OF_COLUMNS / 2);
      return [...existingColumns, recoveredColumn];
    });

    const result = await recoverDataColumnSidecars(blockInput as never, emitter, null);

    expect(result).toBe(DataColumnReconstructionCode.SuccessResolved);
    expect(blockInput.addColumn).toHaveBeenCalledWith(
      expect.objectContaining({
        blockRootHex: blockInput.blockRootHex,
        columnSidecar: recoveredColumn,
        source: BlockInputSource.recovery,
      })
    );
    expect(published).toEqual([
      {
        columns: [recoveredColumn],
        publishPartial: true,
        partialTrigger: "recovery",
      },
    ]);
  });
});
