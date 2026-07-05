import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {ForkName, NUMBER_OF_COLUMNS} from "@lodestar/params";
import {computeStartSlotAtEpoch} from "@lodestar/state-transition";
import {toRootHex} from "@lodestar/utils";
import {getBeaconBlockApi} from "../../../../../../src/api/impl/beacon/blocks/index.js";
import {ApiTestModules, getApiTestModules} from "../../../../../utils/api.js";
import {config, generateBlockWithColumnSidecars} from "../../../../../utils/blocksAndData.js";

describe("api - beacon - blob sidecars", () => {
  let modules: ApiTestModules;
  let api: ReturnType<typeof getBeaconBlockApi>;

  beforeEach(() => {
    modules = getApiTestModules({config});
    api = getBeaconBlockApi(modules);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  function setupPostFuluBlockBeforeAvailableWindow(): {
    blockId: string;
    blockRoot: string;
    getDataColumnSidecars: ReturnType<typeof vi.fn>;
  } {
    const blockSlot = computeStartSlotAtEpoch(config.FULU_FORK_EPOCH);
    const currentEpoch = config.FULU_FORK_EPOCH + config.MIN_EPOCHS_FOR_DATA_COLUMN_SIDECARS_REQUESTS + 1;
    const {block} = generateBlockWithColumnSidecars({forkName: ForkName.fulu, slot: blockSlot});
    const blockRoot = toRootHex(config.getForkTypes(block.message.slot).BeaconBlock.hashTreeRoot(block.message));
    const getDataColumnSidecars = vi.fn();

    modules.chain.getCanonicalBlockAtSlot.mockResolvedValue({
      block,
      executionOptimistic: false,
      finalized: false,
    });
    modules.chain.getBlockByRoot.mockResolvedValue({
      block,
      executionOptimistic: false,
      finalized: false,
    });

    Object.defineProperties(modules.chain, {
      custodyConfig: {
        value: {targetCustodyGroupCount: NUMBER_OF_COLUMNS / 2},
        configurable: true,
      },
      archiveStore: {
        value: {archiveDataEpochs: undefined},
        configurable: true,
      },
      getDataColumnSidecars: {
        value: getDataColumnSidecars,
        configurable: true,
      },
    });
    Object.defineProperty(modules.chain.clock, "currentEpoch", {
      value: currentEpoch,
      configurable: true,
    });

    return {blockId: String(block.message.slot), blockRoot, getDataColumnSidecars};
  }

  it("does not load data columns for post-fulu getBlobSidecars before the available window", async () => {
    const {blockId, getDataColumnSidecars} = setupPostFuluBlockBeforeAvailableWindow();

    await expect(api.getBlobSidecars({blockId})).rejects.toMatchObject({
      statusCode: 404,
      message: expect.stringContaining("Data column sidecars are not available"),
    });
    expect(getDataColumnSidecars).not.toHaveBeenCalled();
  });

  it("does not load data columns for post-fulu getBlobSidecars by root before the available window", async () => {
    const {blockRoot, getDataColumnSidecars} = setupPostFuluBlockBeforeAvailableWindow();

    await expect(api.getBlobSidecars({blockId: blockRoot})).rejects.toMatchObject({
      statusCode: 404,
      message: expect.stringContaining("Data column sidecars are not available"),
    });
    expect(getDataColumnSidecars).not.toHaveBeenCalled();
  });

  it("does not load data columns for post-fulu getBlobs before the available window", async () => {
    const {blockId, getDataColumnSidecars} = setupPostFuluBlockBeforeAvailableWindow();

    await expect(api.getBlobs({blockId})).rejects.toMatchObject({
      statusCode: 404,
      message: expect.stringContaining("Data column sidecars are not available"),
    });
    expect(getDataColumnSidecars).not.toHaveBeenCalled();
  });

  it("serves data columns within the retention window even when earliestAvailableSlot is more recent", async () => {
    // Regression for the over-restriction: the guard keys off the data column retention window, NOT
    // chain.earliestAvailableSlot (the anchor-state slot, which after a restart is more recent than
    // the columns we still retain). A within-window block must reach getDataColumnSidecars.
    // currentEpoch - MIN_EPOCHS == FULU, so the retention window starts at FULU and this fulu block is within it.
    const currentEpoch = config.FULU_FORK_EPOCH + config.MIN_EPOCHS_FOR_DATA_COLUMN_SIDECARS_REQUESTS;
    const blockSlot = computeStartSlotAtEpoch(config.FULU_FORK_EPOCH);
    const {block} = generateBlockWithColumnSidecars({forkName: ForkName.fulu, slot: blockSlot});
    const getDataColumnSidecars = vi.fn().mockResolvedValue([]);

    modules.chain.getCanonicalBlockAtSlot.mockResolvedValue({block, executionOptimistic: false, finalized: false});
    Object.defineProperties(modules.chain, {
      custodyConfig: {value: {targetCustodyGroupCount: NUMBER_OF_COLUMNS / 2}, configurable: true},
      // Anchor slot more recent than the retained block — must NOT restrict serving.
      earliestAvailableSlot: {value: computeStartSlotAtEpoch(config.FULU_FORK_EPOCH + 1), configurable: true},
      archiveStore: {value: {archiveDataEpochs: undefined}, configurable: true},
      getDataColumnSidecars: {value: getDataColumnSidecars, configurable: true},
    });
    Object.defineProperty(modules.chain.clock, "currentEpoch", {value: currentEpoch, configurable: true});

    // Guard passes (within window); falls through to the "not found in db" 404, so getDataColumnSidecars
    // is called — with the old `Math.max(earliestAvailableSlot, ...)` this slot would have been blocked.
    await expect(api.getBlobSidecars({blockId: String(blockSlot)})).rejects.toMatchObject({
      statusCode: 404,
      message: expect.stringContaining("dataColumnSidecars not found in db"),
    });
    expect(getDataColumnSidecars).toHaveBeenCalled();
  });
});
