import {afterEach, describe, expect, it, vi} from "vitest";
import {ForkName} from "@lodestar/params";
import {DataAvailabilityStatus} from "@lodestar/state-transition";
import {ssz} from "@lodestar/types";
import {defer, toRootHex} from "@lodestar/utils";
import {BlockInputPreData, BlockInputSource} from "../../../../src/chain/blocks/blockInput/index.js";
import {validateApiBlock} from "../../../../src/chain/blocks/validateApiBlock.js";
import * as da from "../../../../src/chain/blocks/verifyBlocksDataAvailability.js";
import {getMockedBeaconChain} from "../../../mocks/mockedBeaconChain.js";

describe("API block validation", () => {
  afterEach(() => vi.restoreAllMocks());

  it.each([false, true])("observes the proposer only after successful DA (failure: %s)", async (failure) => {
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
    const validate = vi.fn().mockResolvedValue(undefined);
    chain.beaconEngine.validateApiBlock = validate;
    const observe = vi.spyOn(chain.beaconEngine, "observeVerifiedBlocks");
    const discard = vi.spyOn(chain.beaconEngine, "discardVerifiedBlocks");
    const validation = validateApiBlock.call(chain, blockInput, {});
    const error = new Error("Data unavailable");
    const result = failure ? expect(validation).rejects.toBe(error) : validation;
    await Promise.resolve();
    expect(observe).not.toHaveBeenCalled();
    expect(validate).toHaveBeenCalledExactlyOnceWith(root, ssz.phase0.SignedBeaconBlock.serialize(block), {});

    if (failure) available.reject(error);
    else available.resolve({dataAvailabilityStatuses: [DataAvailabilityStatus.PreData], availableTime: 0});
    await result;

    expect(observe).toHaveBeenCalledTimes(failure ? 0 : 1);
    if (!failure) expect(observe).toHaveBeenCalledWith([{block, root: toRootHex(root)}], true);
    expect(discard).not.toHaveBeenCalled();
    expect(chain.beaconEngine.verifiedBlocks.size).toBe(0);
  });
});
