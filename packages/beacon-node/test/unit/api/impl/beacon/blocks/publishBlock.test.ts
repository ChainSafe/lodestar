import {beforeEach, describe, expect, it, vi} from "vitest";
import {routes} from "@lodestar/api";
import {createBeaconConfig} from "@lodestar/config";
import {config as configDef} from "@lodestar/config/default";
import {ForkName} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {getBeaconBlockApi} from "../../../../../../src/api/impl/beacon/blocks/index.js";
import {BlockInputPreData, BlockInputSource} from "../../../../../../src/chain/blocks/blockInput/index.js";
import {SeenBlockProposers} from "../../../../../../src/chain/seenCache/seenBlockProposers.js";
import {ApiTestModules, getApiTestModules} from "../../../../../utils/api.js";

describe("api - beacon - publishBlockV2", () => {
  const config = createBeaconConfig(configDef, Buffer.alloc(32, 1));
  let modules: ApiTestModules;

  beforeEach(() => {
    modules = getApiTestModules({config});
    Object.defineProperty(modules.chain, "blockProductionCache", {value: new Map()});
    Object.defineProperty(modules.chain, "seenBlockProposers", {value: new SeenBlockProposers()});
    modules.network.publishBeaconBlock = vi.fn();
    modules.chain.processBlock = vi.fn().mockResolvedValue(undefined);
  });

  it("publishes a locally produced pre-Gloas block after equivocation validation", async () => {
    const signedBlock = ssz.phase0.SignedBeaconBlock.defaultValue();
    signedBlock.message.slot = 1;
    signedBlock.message.proposerIndex = 2;
    const blockRoot = toRootHex(
      modules.config.getForkTypes(signedBlock.message.slot).BeaconBlock.hashTreeRoot(signedBlock.message)
    );
    const blockInput = BlockInputPreData.createFromBlock({
      forkName: ForkName.phase0,
      block: signedBlock,
      blockRootHex: blockRoot,
      source: BlockInputSource.api,
      seenTimestampSec: 0,
      daOutOfRange: false,
    });
    vi.spyOn(modules.chain.blockProductionCache, "has").mockReturnValue(true);
    modules.chain.seenBlockInputCache.getByBlock.mockReturnValue(blockInput);

    const api = getBeaconBlockApi(modules);
    await api.publishBlockV2({
      signedBlockContents: {signedBlock},
      broadcastValidation: routes.beacon.BroadcastValidation.consensusAndEquivocation,
    });

    expect(modules.chain.bls.verifySignatureSets).toHaveBeenCalledOnce();
    expect(
      modules.chain.seenBlockProposers.hasBlockRoot(
        signedBlock.message.slot,
        signedBlock.message.proposerIndex,
        blockRoot
      )
    ).toBe(true);
    expect(modules.network.publishBeaconBlock).toHaveBeenCalledWith(signedBlock);
    expect(modules.chain.processBlock).toHaveBeenCalledWith(blockInput, {});
  });

  it("rejects a locally produced pre-Gloas block equivocation before publishing", async () => {
    const signedBlock = ssz.phase0.SignedBeaconBlock.defaultValue();
    signedBlock.message.slot = 1;
    signedBlock.message.proposerIndex = 2;
    const blockRoot = toRootHex(
      modules.config.getForkTypes(signedBlock.message.slot).BeaconBlock.hashTreeRoot(signedBlock.message)
    );
    const conflictingBlockRoot = toRootHex(Buffer.alloc(32, 1));
    const blockInput = BlockInputPreData.createFromBlock({
      forkName: ForkName.phase0,
      block: signedBlock,
      blockRootHex: blockRoot,
      source: BlockInputSource.api,
      seenTimestampSec: 0,
      daOutOfRange: false,
    });
    vi.spyOn(modules.chain.blockProductionCache, "has").mockReturnValue(true);
    modules.chain.seenBlockInputCache.getByBlock.mockReturnValue(blockInput);
    modules.chain.seenBlockProposers.observeBlockRoot(
      signedBlock.message.slot,
      signedBlock.message.proposerIndex,
      conflictingBlockRoot
    );

    const api = getBeaconBlockApi(modules);
    await expect(
      api.publishBlockV2({
        signedBlockContents: {signedBlock},
        broadcastValidation: routes.beacon.BroadcastValidation.consensusAndEquivocation,
      })
    ).rejects.toThrow(/proposer equivocation/);

    expect(modules.network.publishBeaconBlock).not.toHaveBeenCalled();
    expect(modules.chain.processBlock).not.toHaveBeenCalled();
  });
});

describe("api - beacon - publishBlindedBlockV2", () => {
  const config = createBeaconConfig(
    {
      ...configDef,
      ALTAIR_FORK_EPOCH: 0,
      BELLATRIX_FORK_EPOCH: 0,
      CAPELLA_FORK_EPOCH: 0,
      DENEB_FORK_EPOCH: 0,
      ELECTRA_FORK_EPOCH: 0,
      FULU_FORK_EPOCH: 0,
    },
    Buffer.alloc(32, 1)
  );
  let modules: ApiTestModules;

  beforeEach(() => {
    modules = getApiTestModules({config});
    Object.defineProperty(modules.chain, "blockProductionCache", {value: new Map()});
    Object.defineProperty(modules.chain, "seenBlockProposers", {value: new SeenBlockProposers()});
    modules.chain.executionBuilder.submitBlindedBlockNoResponse = vi.fn();
  });

  it("rejects a pre-Gloas blinded block equivocation before revealing it to the builder", async () => {
    const signedBlindedBlock = ssz.fulu.SignedBlindedBeaconBlock.defaultValue();
    signedBlindedBlock.message.slot = 1;
    signedBlindedBlock.message.proposerIndex = 2;
    const conflictingBlockRoot = toRootHex(Buffer.alloc(32, 1));
    modules.chain.seenBlockProposers.observeBlockRoot(
      signedBlindedBlock.message.slot,
      signedBlindedBlock.message.proposerIndex,
      conflictingBlockRoot
    );

    const api = getBeaconBlockApi(modules);
    await expect(
      api.publishBlindedBlockV2({
        signedBlindedBlock,
        broadcastValidation: routes.beacon.BroadcastValidation.consensusAndEquivocation,
      })
    ).rejects.toThrow(/proposer equivocation/);

    expect(modules.chain.executionBuilder.submitBlindedBlockNoResponse).not.toHaveBeenCalled();
  });
});
