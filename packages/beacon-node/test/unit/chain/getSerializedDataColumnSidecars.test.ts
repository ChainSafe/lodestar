import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {createChainForkConfig} from "@lodestar/config";
import {chainConfig} from "@lodestar/config/default";
import {ForkName, NUMBER_OF_COLUMNS} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {BlockInputColumns} from "../../../src/chain/blocks/blockInput/blockInput.js";
import {BlockInputSource} from "../../../src/chain/blocks/blockInput/types.js";
import {RECONSTRUCTED_COLUMNS_WAIT_BPS} from "../../../src/chain/ColumnReconstructionTracker.js";
import {BeaconChain} from "../../../src/chain/chain.js";
import {getMockedLogger} from "../../mocks/loggerMock.js";

describe("BeaconChain.getSerializedDataColumnSidecars", () => {
  const config = createChainForkConfig({...chainConfig, FULU_FORK_EPOCH: 0});
  const slot = 1;
  const blockRootHex = `0x${"aa".repeat(32)}`;
  const allColumns = Array.from({length: NUMBER_OF_COLUMNS}, (_, i) => i);
  const waitMs = config.getSlotComponentDurationMs(ForkName.fulu, RECONSTRUCTED_COLUMNS_WAIT_BPS);

  function addColumn(blockInput: BlockInputColumns, index: number): void {
    const columnSidecar = ssz.fulu.DataColumnSidecar.defaultValue();
    columnSidecar.index = index;
    blockInput.addColumn({blockRootHex, columnSidecar, source: BlockInputSource.gossip, seenTimestampSec: 0});
  }

  function getBlockInput(columnCount: number): BlockInputColumns {
    const block = ssz.fulu.SignedBeaconBlock.defaultValue();
    block.message.slot = slot;
    block.message.body.blobKzgCommitments = [ssz.fulu.KZGCommitment.defaultValue()];
    const blockInput = BlockInputColumns.createFromBlock({
      block,
      blockRootHex,
      source: BlockInputSource.gossip,
      seenTimestampSec: 0,
      forkName: ForkName.fulu,
      daOutOfRange: false,
      custodyColumns: allColumns,
      sampledColumns: allColumns,
    });
    for (let i = 0; i < columnCount; i++) {
      addColumn(blockInput, i);
    }
    return blockInput;
  }

  function getChain(blockInput: BlockInputColumns, {reconstructs}: {reconstructs: boolean}) {
    const triggerColumnReconstruction = vi.fn((input: BlockInputColumns) => {
      if (reconstructs) {
        setTimeout(() => {
          for (const index of allColumns) {
            if (!input.hasColumn(index)) addColumn(input, index);
          }
        }, waitMs / 2);
      }
    });
    const chain = {
      config,
      logger: getMockedLogger(),
      seenBlockInputCache: {get: () => blockInput},
      seenPayloadEnvelopeInputCache: {get: () => undefined},
      serializedCache: new WeakMap<object, Uint8Array>(),
      columnReconstructionTracker: {triggerColumnReconstruction},
      db: {
        dataColumns: {getManyBinary: vi.fn(async (_id: unknown, indices: number[]) => indices.map(() => undefined))},
      },
    } as unknown as BeaconChain;
    return {chain, triggerColumnReconstruction};
  }

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("serves columns reconstructed after the block became available with half of them", async () => {
    const blockInput = getBlockInput(NUMBER_OF_COLUMNS / 2);
    const {chain, triggerColumnReconstruction} = getChain(blockInput, {reconstructs: true});

    const response = BeaconChain.prototype.getSerializedDataColumnSidecars.call(chain, slot, blockRootHex, [0, 100]);
    await vi.advanceTimersByTimeAsync(waitMs);

    expect(triggerColumnReconstruction).toHaveBeenCalledExactlyOnceWith(blockInput);
    const reconstructed = ssz.fulu.DataColumnSidecar.serialize({
      ...ssz.fulu.DataColumnSidecar.defaultValue(),
      index: 100,
    });
    expect(await response).toEqual([expect.any(Uint8Array), reconstructed]);
  });

  it("serves the columns it has if reconstruction does not finish in time", async () => {
    const blockInput = getBlockInput(NUMBER_OF_COLUMNS / 2);
    const {chain, triggerColumnReconstruction} = getChain(blockInput, {reconstructs: false});

    const response = BeaconChain.prototype.getSerializedDataColumnSidecars.call(chain, slot, blockRootHex, [0, 100]);
    await vi.advanceTimersByTimeAsync(waitMs);

    expect(triggerColumnReconstruction).toHaveBeenCalledOnce();
    expect(await response).toEqual([expect.any(Uint8Array), undefined]);
  });

  it.each([
    {name: "the requested columns are present", columnCount: NUMBER_OF_COLUMNS / 2, indices: [0, 1]},
    {name: "fewer than half the columns are present", columnCount: NUMBER_OF_COLUMNS / 2 - 1, indices: [0, 100]},
  ])("does not wait for reconstruction if $name", async ({columnCount, indices}) => {
    const blockInput = getBlockInput(columnCount);
    const {chain, triggerColumnReconstruction} = getChain(blockInput, {reconstructs: true});

    const response = await BeaconChain.prototype.getSerializedDataColumnSidecars.call(
      chain,
      slot,
      blockRootHex,
      indices
    );

    expect(triggerColumnReconstruction).not.toHaveBeenCalled();
    expect(response).toEqual(indices.map((index) => (index < columnCount ? expect.any(Uint8Array) : undefined)));
  });
});
