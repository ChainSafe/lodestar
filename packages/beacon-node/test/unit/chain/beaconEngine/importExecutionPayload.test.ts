import {beforeEach, describe, expect, it, vi} from "vitest";
import {ExecutionStatus} from "@lodestar/fork-choice";
import {ForkName} from "@lodestar/params";
import {DataAvailabilityStatus} from "@lodestar/state-transition";
import {ErrorAborted, toRootHex} from "@lodestar/utils";
import {BeaconEngine} from "../../../../src/chain/beaconEngine/beaconEngine.js";
import {ZERO_HASH_HEX} from "../../../../src/constants/index.js";
import {QueueError, QueueErrorCode} from "../../../../src/util/queue/index.js";
import {MockedBeaconChain, getMockedBeaconChain} from "../../../mocks/mockedBeaconChain.js";
import {zeroProtoBlock} from "../../../utils/state.js";

describe("BeaconEngine importExecutionPayload FCU", () => {
  const blockRoot = Buffer.alloc(32, 1);
  const blockRootHex = toRootHex(blockRoot);
  const blockHashHex = toRootHex(Buffer.alloc(32, 2));
  const finalizedBlockHash = toRootHex(Buffer.alloc(32, 3));
  let chain: MockedBeaconChain;

  beforeEach(() => {
    chain = getMockedBeaconChain();
    chain.forkChoice.onExecutionPayload = vi.fn();
    chain.forkChoice.getHead.mockReturnValue({...zeroProtoBlock, blockRoot: blockRootHex});
    chain.forkChoice.getFinalizedBlock.mockReturnValue({
      ...zeroProtoBlock,
      executionStatus: ExecutionStatus.Valid,
      executionPayloadBlockHash: finalizedBlockHash,
      executionPayloadNumber: 100,
      executionPayloadGasLimit: 30_000_000,
      dataAvailabilityStatus: DataAvailabilityStatus.Available,
    });
    chain.executionEngine.notifyForkchoiceUpdate.mockResolvedValue(null);
    vi.spyOn(chain.config, "getForkName").mockReturnValue(ForkName.gloas);
  });

  function importPayload(execStatus: ExecutionStatus.Valid | ExecutionStatus.Syncing = ExecutionStatus.Valid) {
    // The existing flat chain mock doubles as the engine, with the same shared EL client.
    return BeaconEngine.prototype.importExecutionPayload.call(
      chain.beaconEngine,
      blockRoot,
      blockHashHex,
      123,
      30_000_000,
      execStatus,
      DataAvailabilityStatus.Available
    );
  }

  it("imports the payload before sending FCU with the head, safe, and finalized hashes", () => {
    expect(importPayload()).toEqual({executionOptimistic: false});
    expect(chain.forkChoice.onExecutionPayload).toHaveBeenCalledWith(
      blockRootHex,
      blockHashHex,
      123,
      30_000_000,
      ExecutionStatus.Valid,
      DataAvailabilityStatus.Available
    );
    expect(chain.executionEngine.notifyForkchoiceUpdate).toHaveBeenCalledExactlyOnceWith(
      ForkName.gloas,
      blockHashHex,
      ZERO_HASH_HEX,
      finalizedBlockHash
    );
    expect(chain.forkChoice.onExecutionPayload.mock.invocationCallOrder[0]).toBeLessThan(
      chain.executionEngine.notifyForkchoiceUpdate.mock.invocationCallOrder[0]
    );
  });

  it("imports without FCU when import updates are disabled", () => {
    chain.opts.disableImportExecutionFcU = true;
    expect(importPayload(ExecutionStatus.Syncing)).toEqual({executionOptimistic: true});
    expect(chain.forkChoice.onExecutionPayload).toHaveBeenCalledOnce();
    expect(chain.executionEngine.notifyForkchoiceUpdate).not.toHaveBeenCalled();
  });

  it("does not send FCU for a non-head payload", () => {
    chain.forkChoice.getHead.mockReturnValue(zeroProtoBlock);
    importPayload();
    expect(chain.executionEngine.notifyForkchoiceUpdate).not.toHaveBeenCalled();
  });

  it("does not wait for the EL response", () => {
    chain.executionEngine.notifyForkchoiceUpdate.mockReturnValue(new Promise(() => {}));
    expect(importPayload()).toEqual({executionOptimistic: false});
  });

  it("logs an EL failure without rejecting import", async () => {
    const error = new Error("EL unavailable");
    chain.executionEngine.notifyForkchoiceUpdate.mockRejectedValue(error);
    expect(importPayload()).toEqual({executionOptimistic: false});
    await Promise.resolve();
    expect(chain.logger.error).toHaveBeenCalledWith(
      "Error pushing notifyForkchoiceUpdate()",
      {blockHashHex, finalizedBlockHash},
      error
    );
  });

  it.each([new ErrorAborted(), new QueueError({code: QueueErrorCode.QUEUE_ABORTED})])(
    "suppresses shutdown errors: %s",
    async (error) => {
      chain.executionEngine.notifyForkchoiceUpdate.mockRejectedValue(error);
      importPayload();
      await Promise.resolve();
      expect(chain.logger.error).not.toHaveBeenCalled();
    }
  );
});
