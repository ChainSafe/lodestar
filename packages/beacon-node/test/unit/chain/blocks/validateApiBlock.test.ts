import {afterEach, describe, expect, it, vi} from "vitest";
import {ForkName} from "@lodestar/params";
import {DataAvailabilityStatus} from "@lodestar/state-transition";
import {ssz} from "@lodestar/types";
import {defer, toRootHex} from "@lodestar/utils";
import {blockFailureFromError} from "../../../../src/chain/beaconEngine/processingResult.js";
import {BlockInputPreData, BlockInputSource} from "../../../../src/chain/blocks/blockInput/index.js";
import {validateApiBlock} from "../../../../src/chain/blocks/validateApiBlock.js";
import * as da from "../../../../src/chain/blocks/verifyBlocksDataAvailability.js";
import {BlockError, BlockErrorCode} from "../../../../src/chain/errors/blockError.js";
import {getMockedBeaconChain, withBeaconEngineFacade} from "../../../mocks/mockedBeaconChain.js";

describe("API block validation", () => {
  afterEach(() => vi.restoreAllMocks());

  it("rehydrates a cloned failure and aborts pending DA without observing the proposer", async () => {
    const chain = getMockedBeaconChain();
    const block = ssz.phase0.SignedBeaconBlock.defaultValue();
    const root = ssz.phase0.BeaconBlock.hashTreeRoot(block.message);
    const blockInput = BlockInputPreData.createFromBlock({
      block,
      blockRootHex: toRootHex(root),
      forkName: ForkName.phase0,
      source: BlockInputSource.api,
      seenTimestampSec: 0,
      daOutOfRange: false,
    });
    const error = new BlockError(block, {code: BlockErrorCode.INVALID_SIGNATURE, stateSlot: 0});
    chain.beaconEngine.validateApiBlock = vi
      .fn()
      .mockResolvedValue(structuredClone({err: blockFailureFromError(error, chain.config, [root])}));
    const available = vi
      .spyOn(da, "verifyBlocksDataAvailability")
      .mockImplementation(
        (_blocks, signal) =>
          new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("aborted"))))
      );
    const observe = vi.spyOn(chain.beaconEngine.seenBlockProposers, "observeBlockRoot");
    const validation = validateApiBlock.call(withBeaconEngineFacade(chain), blockInput, {});
    await expect(validation).rejects.toBeInstanceOf(BlockError);
    await validation.catch((failure: BlockError) => {
      expect(failure.signedBlock).toBe(block);
      expect(failure.type).toEqual(error.type);
    });
    expect(chain.beaconEngine.validateApiBlock).toHaveBeenCalledExactlyOnceWith(
      root,
      ssz.phase0.SignedBeaconBlock.serialize(block),
      {}
    );
    expect(available.mock.calls[0][1].aborted).toBe(true);
    expect(observe).not.toHaveBeenCalled();
    expect(chain.beaconEngine.verifiedBlocks.size).toBe(0);
  });

  it.each([false, true])("waits for DA without discarding an import bundle (failure: %s)", async (failure) => {
    const chain = getMockedBeaconChain();
    const block = ssz.phase0.SignedBeaconBlock.defaultValue();
    const root = ssz.phase0.BeaconBlock.hashTreeRoot(block.message);
    const blockInput = BlockInputPreData.createFromBlock({
      block,
      blockRootHex: toRootHex(root),
      forkName: ForkName.phase0,
      source: BlockInputSource.api,
      seenTimestampSec: 0,
      daOutOfRange: false,
    });
    const available = defer<Awaited<ReturnType<typeof da.verifyBlocksDataAvailability>>>();
    vi.spyOn(da, "verifyBlocksDataAvailability").mockReturnValue(available.promise);
    const validate = vi.fn().mockResolvedValue({err: null, result: undefined});
    chain.beaconEngine.validateApiBlock = validate;
    const discard = vi.spyOn(chain.beaconEngine, "discardVerifiedBlocks");
    const validation = validateApiBlock.call(withBeaconEngineFacade(chain), blockInput, {});
    let settled = false;
    void validation.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      }
    );
    const error = new Error("Data unavailable");
    const result = failure ? expect(validation).rejects.toBe(error) : validation;
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(validate).toHaveBeenCalledExactlyOnceWith(root, ssz.phase0.SignedBeaconBlock.serialize(block), {});

    if (failure) available.reject(error);
    else available.resolve({dataAvailabilityStatuses: [DataAvailabilityStatus.PreData], availableTime: 0});
    await result;

    expect(settled).toBe(true);
    expect(discard).not.toHaveBeenCalled();
    expect(chain.beaconEngine.verifiedBlocks.size).toBe(0);
  });
});
