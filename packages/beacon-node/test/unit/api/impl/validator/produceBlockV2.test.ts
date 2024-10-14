import {fromHexString, toHexString} from "@chainsafe/ssz";
import {describe, it, expect, beforeEach, afterEach, vi} from "vitest";
import {ssz} from "@lodestar/types";
import {ProtoBlock} from "@lodestar/fork-choice";
import {ForkName} from "@lodestar/params";
import {computeTimeAtSlot, CachedBeaconStateBellatrix} from "@lodestar/state-transition";
import {ApiTestModules, getApiTestModules} from "../../../../utils/api.js";
import {SyncState} from "../../../../../src/sync/interface.js";
import {getValidatorApi} from "../../../../../src/api/impl/validator/index.js";
import {BeaconChain} from "../../../../../src/chain/index.js";
import {generateCachedBellatrixState} from "../../../../utils/state.js";
import {PayloadIdCache} from "../../../../../src/execution/engine/payloadIdCache.js";
import {toGraffitiBuffer} from "../../../../../src/util/graffiti.js";
import {BlockType, produceBlockBody} from "../../../../../src/chain/produceBlock/produceBlockBody.js";
import {generateProtoBlock} from "../../../../utils/typeGenerator.js";
import {ZERO_HASH_HEX} from "../../../../../src/constants/index.js";
import {defaultApiOptions} from "../../../../../src/api/options.js";

describe("api/validator - produceBlockV2", () => {
  let api: ReturnType<typeof getValidatorApi>;
  let modules: ApiTestModules;
  let state: CachedBeaconStateBellatrix;

  beforeEach(() => {
    modules = getApiTestModules();
    api = getValidatorApi(defaultApiOptions, modules);

    state = generateCachedBellatrixState();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("correctly pass feeRecipient to produceBlock", async () => {
    const fullBlock = ssz.bellatrix.BeaconBlock.defaultValue();
    const executionPayloadValue = ssz.Wei.defaultValue();
    const consensusBlockValue = ssz.Wei.defaultValue();

    const currentSlot = 100000;
    vi.spyOn(modules.chain.clock, "currentSlot", "get").mockReturnValue(currentSlot);
    vi.spyOn(modules.sync, "state", "get").mockReturnValue(SyncState.Synced);

    // Set the node's state to way back from current slot
    const slot = 100000;
    const randaoReveal = fullBlock.body.randaoReveal;
    const parentBlockRoot = fullBlock.parentRoot;
    const graffiti = "a".repeat(32);
    const feeRecipient = "0xcccccccccccccccccccccccccccccccccccccccc";

    modules.chain.getProposerHead.mockReturnValue(generateProtoBlock({blockRoot: toHexString(parentBlockRoot)}));
    modules.chain.recomputeForkChoiceHead.mockReturnValue(
      generateProtoBlock({blockRoot: toHexString(parentBlockRoot)})
    );
    modules.chain.forkChoice.getBlock.mockReturnValue(generateProtoBlock({blockRoot: toHexString(parentBlockRoot)}));
    modules.chain.produceBlock.mockResolvedValue({
      block: fullBlock,
      executionPayloadValue,
      consensusBlockValue,
    });

    // check if expectedFeeRecipient is passed to produceBlock
    await api.produceBlockV2({slot, randaoReveal, graffiti, feeRecipient});
    expect(modules.chain.produceBlock).toBeCalledWith({
      randaoReveal,
      graffiti: toGraffitiBuffer(graffiti),
      slot,
      parentBlockRoot,
      feeRecipient,
    });

    // check that no feeRecipient is passed to produceBlock so that produceBlockBody will
    // pick it from beaconProposerCache
    await api.produceBlockV2({slot, randaoReveal, graffiti});
    expect(modules.chain.produceBlock).toBeCalledWith({
      randaoReveal,
      graffiti: toGraffitiBuffer(graffiti),
      slot,
      parentBlockRoot,
      feeRecipient: undefined,
    });
  });

  it("correctly use passed feeRecipient in notifyForkchoiceUpdate", async () => {
    const fullBlock = ssz.bellatrix.BeaconBlock.defaultValue();
    const executionPayloadValue = ssz.Wei.defaultValue();
    const slot = 100000;
    const randaoReveal = fullBlock.body.randaoReveal;
    const graffiti = "a".repeat(32);
    const feeRecipient = "0xccccccccccccccccccccccccccccccccccccccaa";

    const headSlot = 0;
    modules.chain.getProposerHead.mockReturnValue(generateProtoBlock({slot: headSlot}));

    modules.chain.recomputeForkChoiceHead.mockReturnValue(generateProtoBlock({slot: headSlot}));
    modules.chain["opPool"].getSlashingsAndExits.mockReturnValue([[], [], [], []]);
    modules.chain["aggregatedAttestationPool"].getAttestationsForBlock.mockReturnValue([]);
    modules.chain["eth1"].getEth1DataAndDeposits.mockResolvedValue({
      eth1Data: ssz.phase0.Eth1Data.defaultValue(),
      deposits: [],
    });
    modules.forkChoice.getJustifiedBlock.mockReturnValue({} as ProtoBlock);
    modules.forkChoice.getFinalizedBlock.mockReturnValue({} as ProtoBlock);

    modules.chain["executionEngine"].payloadIdCache = new PayloadIdCache();
    modules.chain["executionEngine"].notifyForkchoiceUpdate.mockResolvedValue("0x");
    modules.chain["executionEngine"].getPayload.mockResolvedValue({
      executionPayload: ssz.bellatrix.ExecutionPayload.defaultValue(),
      executionPayloadValue,
    });

    // use fee recipient passed in produceBlockBody call for payload gen in engine notifyForkchoiceUpdate
    await produceBlockBody.call(modules.chain as unknown as BeaconChain, BlockType.Full, state, {
      randaoReveal,
      graffiti: toGraffitiBuffer(graffiti),
      slot,
      feeRecipient,
      parentSlot: slot - 1,
      parentBlockRoot: fromHexString(ZERO_HASH_HEX),
      proposerIndex: 0,
      proposerPubKey: new Uint8Array(32).fill(1),
    });

    expect(modules.chain["executionEngine"].notifyForkchoiceUpdate).toBeCalledWith(
      ForkName.bellatrix,
      ZERO_HASH_HEX,
      ZERO_HASH_HEX,
      ZERO_HASH_HEX,
      {
        timestamp: computeTimeAtSlot(modules.config, state.slot, state.genesisTime),
        prevRandao: new Uint8Array(32),
        suggestedFeeRecipient: feeRecipient,
      }
    );

    // use fee recipient set in beaconProposerCacheStub if none passed
    modules.chain["beaconProposerCache"].getOrDefault.mockReturnValue("0x fee recipient address");
    await produceBlockBody.call(modules.chain as unknown as BeaconChain, BlockType.Full, state, {
      randaoReveal,
      graffiti: toGraffitiBuffer(graffiti),
      slot,
      parentSlot: slot - 1,
      parentBlockRoot: fromHexString(ZERO_HASH_HEX),
      proposerIndex: 0,
      proposerPubKey: new Uint8Array(32).fill(1),
    });

    expect(modules.chain["executionEngine"].notifyForkchoiceUpdate).toBeCalledWith(
      ForkName.bellatrix,
      ZERO_HASH_HEX,
      ZERO_HASH_HEX,
      ZERO_HASH_HEX,
      {
        timestamp: computeTimeAtSlot(modules.config, state.slot, state.genesisTime),
        prevRandao: new Uint8Array(32),
        suggestedFeeRecipient: "0x fee recipient address",
      }
    );
  });
});
