import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {ForkName, NUMBER_OF_COLUMNS} from "@lodestar/params";
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
    const {block} = generateBlockWithColumnSidecars({forkName: ForkName.fulu});
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
      earliestAvailableSlot: {
        value: block.message.slot + 1,
        configurable: true,
      },
      getDataColumnSidecars: {
        value: getDataColumnSidecars,
        configurable: true,
      },
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
});
