import {describe, expect, it, vi} from "vitest";
import {createChainForkConfig} from "@lodestar/config";
import {config as configDef} from "@lodestar/config/default";
import {ExecutionStatus, ProtoBlock} from "@lodestar/fork-choice";
import {ForkName} from "@lodestar/params";
import {DataAvailabilityStatus, IBeaconStateView} from "@lodestar/state-transition";
import {ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {BlockInputNoData} from "../../../../src/chain/blocks/blockInput/blockInput.js";
import {BlockInputSource} from "../../../../src/chain/blocks/blockInput/types.js";
import {importBlock} from "../../../../src/chain/blocks/importBlock.js";
import {FullyVerifiedBlock} from "../../../../src/chain/blocks/types.js";
import type {BeaconChain} from "../../../../src/chain/chain.js";
import {getMockedLogger} from "../../../mocks/loggerMock.js";

describe("chain / blocks / importBlock", () => {
  const config = createChainForkConfig({...configDef, FULU_FORK_EPOCH: 0, GLOAS_FORK_EPOCH: 0});
  const parentRoot = Buffer.alloc(32, 1);
  const parentBlockHash = Buffer.alloc(32, 2);
  const stopAfterOnBlock = new Error("stop after onBlock");

  function importGloasBlock(parentVariant: ProtoBlock | null) {
    const block = ssz.gloas.SignedBeaconBlock.defaultValue();
    block.message.slot = 1;
    block.message.parentRoot = parentRoot;
    block.message.body.signedExecutionPayloadBid.message.parentBlockHash = parentBlockHash;
    const blockInput = BlockInputNoData.createFromBlock({
      block,
      blockRootHex: toRootHex(ssz.gloas.BeaconBlock.hashTreeRoot(block.message)),
      forkName: ForkName.gloas,
      daOutOfRange: false,
      source: BlockInputSource.gossip,
      seenTimestampSec: 0,
    });

    const forkChoice = {
      getTime: vi.fn().mockReturnValue(1),
      getFinalizedCheckpoint: vi.fn().mockReturnValue({epoch: 0}),
      // The parent's default (PENDING) variant is VALID, only the payload variant may differ
      getBlockHexDefaultStatus: vi.fn().mockReturnValue({executionStatus: ExecutionStatus.Valid} as ProtoBlock),
      getBlockHexAndBlockHash: vi.fn().mockReturnValue(parentVariant),
      onBlock: vi.fn().mockImplementation(() => {
        throw stopAfterOnBlock;
      }),
    };
    const chain = {
      config,
      forkChoice,
      logger: getMockedLogger(),
      clock: {secFromSlot: vi.fn().mockReturnValue(0)},
      unfinalizedBlockWrites: {
        waitForSpace: vi.fn().mockResolvedValue(undefined),
        push: vi.fn().mockResolvedValue(undefined),
      },
      checkpointBalancesCache: {processState: vi.fn()},
    } as unknown as BeaconChain;

    const fullyVerifiedBlock: FullyVerifiedBlock = {
      blockInput,
      postState: {genesisTime: 0} as IBeaconStateView,
      parentBlockSlot: 0,
      proposerBalanceDelta: 0,
      dataAvailabilityStatus: DataAvailabilityStatus.NotRequired,
      indexedAttestations: [],
      seenTimestampSec: 0,
      executionStatus: ExecutionStatus.Valid,
    };

    return {forkChoice, result: importBlock.call(chain, fullyVerifiedBlock, {})};
  }

  it.each([ExecutionStatus.Syncing, ExecutionStatus.Valid])(
    "gloas block inherits %s from the parent variant its bid builds on",
    async (parentStatus) => {
      const {forkChoice, result} = importGloasBlock({executionStatus: parentStatus} as ProtoBlock);

      await expect(result).rejects.toThrow(stopAfterOnBlock);
      expect(forkChoice.getBlockHexAndBlockHash).toHaveBeenCalledWith(
        toRootHex(parentRoot),
        toRootHex(parentBlockHash)
      );
      expect(forkChoice.onBlock.mock.calls[0][5]).toBe(parentStatus);
    }
  );

  it("rejects a gloas block building on an invalid parent payload", async () => {
    const {forkChoice, result} = importGloasBlock({executionStatus: ExecutionStatus.Invalid} as ProtoBlock);

    await expect(result).rejects.toThrow("Parent block has invalid execution status");
    expect(forkChoice.onBlock).not.toHaveBeenCalled();
  });

  it("rejects a gloas block whose parent variant is unknown", async () => {
    const {forkChoice, result} = importGloasBlock(null);

    await expect(result).rejects.toThrow("Parent block not found in forkChoice");
    expect(forkChoice.onBlock).not.toHaveBeenCalled();
  });
});
