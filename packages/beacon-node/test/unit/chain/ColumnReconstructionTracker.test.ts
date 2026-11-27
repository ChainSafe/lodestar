import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {createChainForkConfig} from "@lodestar/config";
import {config} from "@lodestar/config/default";
import {ForkName, NUMBER_OF_COLUMNS, SLOTS_PER_EPOCH} from "@lodestar/params";
import {toRootHex} from "@lodestar/utils";
import {BlockInputColumns} from "../../../src/chain/blocks/blockInput/index.js";
import {ColumnReconstructionTracker} from "../../../src/chain/ColumnReconstructionTracker.js";
import {ChainEventEmitter} from "../../../src/chain/emitter.js";
import {DataColumnReconstructionCode, recoverDataColumnSidecars} from "../../../src/util/dataColumns.js";
import {getMockedLogger} from "../../mocks/loggerMock.js";

vi.mock("../../../src/util/dataColumns.js", async (importActual) => {
  const actual = await importActual<typeof import("../../../src/util/dataColumns.js")>();
  return {...actual, recoverDataColumnSidecars: vi.fn()};
});

function fakeInput(blockRootHex: string, slot: number, columnCount = NUMBER_OF_COLUMNS / 2): BlockInputColumns {
  return {blockRootHex, slot, getAllColumns: () => new Array(columnCount)} as unknown as BlockInputColumns;
}

describe("ColumnReconstructionTracker", () => {
  const maxDelayMs = config.getSlotComponentDurationMs(config.getForkName(0), 1000);
  let tracker: ColumnReconstructionTracker;
  let recover: ReturnType<typeof vi.fn>;

  function reconstructedRoots(): string[] {
    return recover.mock.calls.map((call) => (call[0] as BlockInputColumns).blockRootHex);
  }

  beforeEach(() => {
    vi.useFakeTimers();
    recover = vi.mocked(recoverDataColumnSidecars);
    recover.mockReset();
    recover.mockResolvedValue(DataColumnReconstructionCode.SuccessResolved);
    tracker = new ColumnReconstructionTracker({
      logger: getMockedLogger(),
      emitter: new ChainEventEmitter(),
      metrics: null,
      config,
      signal: new AbortController().signal,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("reconstructs a root after the delay", async () => {
    tracker.triggerColumnReconstruction(fakeInput("0xaa", 1));
    expect(recover).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(maxDelayMs);
    expect(reconstructedRoots()).toEqual(["0xaa"]);
  });

  it("ignores a root with fewer than half the columns", async () => {
    tracker.triggerColumnReconstruction(fakeInput("0xaa", 1, NUMBER_OF_COLUMNS / 2 - 1));
    await vi.advanceTimersByTimeAsync(maxDelayMs);
    expect(recover).not.toHaveBeenCalled();
  });

  it("deduplicates triggers for a root that is queued or in-flight", async () => {
    tracker.triggerColumnReconstruction(fakeInput("0xaa", 1));
    tracker.triggerColumnReconstruction(fakeInput("0xaa", 1));
    tracker.triggerColumnReconstruction(fakeInput("0xbb", 2));
    tracker.triggerColumnReconstruction(fakeInput("0xbb", 2));
    tracker.triggerColumnReconstruction(fakeInput("0xaa", 1));

    await vi.advanceTimersByTimeAsync(maxDelayMs * 2);
    expect(reconstructedRoots()).toEqual(["0xaa", "0xbb"]);
  });

  it("drains a second root triggered while the first is in-flight", async () => {
    tracker.triggerColumnReconstruction(fakeInput("0xaa", 1));
    await vi.advanceTimersByTimeAsync(maxDelayMs / 2);
    tracker.triggerColumnReconstruction(fakeInput("0xbb", 2));

    await vi.advanceTimersByTimeAsync(maxDelayMs * 2);
    expect(reconstructedRoots()).toEqual(["0xaa", "0xbb"]);
  });

  it("runs one reconstruction at a time", async () => {
    let finishFirst: (code: DataColumnReconstructionCode) => void = () => {};
    recover.mockImplementationOnce(
      () =>
        new Promise<DataColumnReconstructionCode>((resolve) => {
          finishFirst = resolve;
        })
    );

    tracker.triggerColumnReconstruction(fakeInput("0xaa", 1));
    tracker.triggerColumnReconstruction(fakeInput("0xbb", 2));
    await vi.advanceTimersByTimeAsync(maxDelayMs * 3);
    expect(reconstructedRoots()).toEqual(["0xaa"]);

    finishFirst(DataColumnReconstructionCode.SuccessResolved);
    await vi.advanceTimersByTimeAsync(maxDelayMs);
    expect(reconstructedRoots()).toEqual(["0xaa", "0xbb"]);
  });

  it("drains the queue after a failed attempt", async () => {
    recover.mockRejectedValueOnce(new Error("kzg failure"));

    tracker.triggerColumnReconstruction(fakeInput("0xaa", 1));
    tracker.triggerColumnReconstruction(fakeInput("0xbb", 2));

    await vi.advanceTimersByTimeAsync(maxDelayMs * 2);
    expect(reconstructedRoots()).toEqual(["0xaa", "0xbb"]);
  });

  it("allows a root to be retried once its attempt has finished", async () => {
    tracker.triggerColumnReconstruction(fakeInput("0xaa", 1));
    await vi.advanceTimersByTimeAsync(maxDelayMs);
    tracker.triggerColumnReconstruction(fakeInput("0xaa", 1));
    await vi.advanceTimersByTimeAsync(maxDelayMs);

    expect(reconstructedRoots()).toEqual(["0xaa", "0xaa"]);
  });

  it.each([0, 1])("uses each input's fork for reconstruction delay, random=%i", async (random) => {
    vi.spyOn(Math, "random").mockReturnValue(random);
    const forkConfig = createChainForkConfig({FULU_FORK_EPOCH: 0, GLOAS_FORK_EPOCH: 1});
    forkConfig.getSlotDurationMs = (fork) => (fork === ForkName.fulu ? 12000 : 6000);
    const emitter = new ChainEventEmitter();
    const forkTracker = new ColumnReconstructionTracker({
      config: forkConfig,
      emitter,
      metrics: null,
      logger: getMockedLogger(),
      signal: new AbortController().signal,
    });

    for (const slot of [SLOTS_PER_EPOCH - 1, SLOTS_PER_EPOCH]) {
      const fork = forkConfig.getForkName(slot);
      const input = fakeInput(toRootHex(Buffer.alloc(32, slot)), slot);
      const delay = fork === ForkName.fulu ? (random === 0 ? 800 : 1200) : random === 0 ? 400 : 600;
      recover.mockClear();

      forkTracker.triggerColumnReconstruction(input);
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(recover, `before reconstruction in slot ${slot}`).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(recover, `reconstruction in slot ${slot}`).toHaveBeenCalledExactlyOnceWith(input, emitter, null);
    }
  });
});
