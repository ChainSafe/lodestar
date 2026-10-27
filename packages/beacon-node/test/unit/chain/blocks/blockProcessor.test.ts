import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {DataAvailabilityStatus} from "@lodestar/state-transition";
import {ErrorAborted} from "@lodestar/utils";
import {IBlockInput} from "../../../../src/chain/blocks/blockInput/types.js";
import {BlockProcessor} from "../../../../src/chain/blocks/index.js";
import {verifyBlocksDataAvailability} from "../../../../src/chain/blocks/verifyBlocksDataAvailability.js";
import {verifyBlocksSanityChecks} from "../../../../src/chain/blocks/verifyBlocksSanityChecks.js";
import type {BeaconChain} from "../../../../src/chain/chain.js";

vi.mock("../../../../src/chain/blocks/verifyBlocksDataAvailability.js");
vi.mock("../../../../src/chain/blocks/verifyBlocksSanityChecks.js");

function dataAvailable(): ReturnType<typeof verifyBlocksDataAvailability> {
  return Promise.resolve({dataAvailabilityStatuses: [DataAvailabilityStatus.Available], availableTime: 0});
}

describe("chain / blocks / BlockProcessor", () => {
  let processor: BlockProcessor;
  let abortController: AbortController;
  let blockInput: IBlockInput;

  beforeEach(() => {
    abortController = new AbortController();
    processor = new BlockProcessor({} as BeaconChain, null, {}, abortController.signal);
    // The DA wait is mocked, the input is only used as an identity key
    blockInput = {} as IBlockInput;
    vi.mocked(verifyBlocksDataAvailability).mockImplementation(() => dataAvailable());
    // No relevant blocks, processBlocks returns before touching the chain
    vi.mocked(verifyBlocksSanityChecks).mockReturnValue({relevantBlocks: [], parentSlots: [], parentBlock: null});
  });

  afterEach(() => {
    abortController.abort();
    vi.resetAllMocks();
  });

  it("should wait for the block data before taking a queue slot", async () => {
    let resolveData: () => void = () => {};
    vi.mocked(verifyBlocksDataAvailability).mockReturnValue(
      new Promise((resolve) => {
        resolveData = () => resolve({dataAvailabilityStatuses: [DataAvailabilityStatus.Available], availableTime: 0});
      })
    );

    let resolved = false;
    const job = processor.processBlocksJob([blockInput], null).then(() => {
      resolved = true;
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(verifyBlocksSanityChecks).not.toHaveBeenCalled();
    expect(resolved).toBe(false);

    resolveData();
    await job;
    expect(verifyBlocksSanityChecks).toHaveBeenCalledTimes(1);
  });

  it("should not hold a later block behind one still waiting for its data", async () => {
    const stuckInput = {} as IBlockInput;
    let resolveStuckData: () => void = () => {};
    vi.mocked(verifyBlocksDataAvailability).mockImplementation(([input]) => {
      if (input === stuckInput) {
        return new Promise((resolve) => {
          resolveStuckData = () =>
            resolve({dataAvailabilityStatuses: [DataAvailabilityStatus.Available], availableTime: 0});
        });
      }
      return dataAvailable();
    });

    let stuckResolved = false;
    const stuck = processor.processBlocksJob([stuckInput], null).then(() => {
      stuckResolved = true;
    });

    // The block queued second must import while the first is still waiting for its blobs or columns
    await processor.processBlocksJob([blockInput], null);
    expect(verifyBlocksSanityChecks).toHaveBeenCalledTimes(1);
    expect(vi.mocked(verifyBlocksSanityChecks).mock.calls[0][1]).toEqual([blockInput]);
    expect(stuckResolved).toBe(false);

    resolveStuckData();
    await stuck;
    expect(verifyBlocksSanityChecks).toHaveBeenCalledTimes(2);
    expect(vi.mocked(verifyBlocksSanityChecks).mock.calls[1][1]).toEqual([stuckInput]);
  });

  it("should surface a data availability failure without queuing the job", async () => {
    vi.mocked(verifyBlocksDataAvailability).mockRejectedValueOnce(new Error("DATA_UNAVAILABLE"));

    await expect(processor.processBlocksJob([blockInput], null)).rejects.toThrow("DATA_UNAVAILABLE");
    expect(verifyBlocksSanityChecks).not.toHaveBeenCalled();
  });

  it("should return an empty result when the data wait is aborted", async () => {
    vi.mocked(verifyBlocksDataAvailability).mockRejectedValueOnce(new ErrorAborted());

    await expect(processor.processBlocksJob([blockInput], null)).resolves.toEqual({orphaned: [], skipped: false});
    expect(verifyBlocksSanityChecks).not.toHaveBeenCalled();
  });
});
