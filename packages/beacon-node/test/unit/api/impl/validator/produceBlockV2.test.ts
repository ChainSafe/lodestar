import {fromHexString} from "@chainsafe/ssz";
import {describe, it, expect, beforeEach, afterEach, MockedObject, vi} from "vitest";
import {ssz} from "@lodestar/types";
import {config} from "@lodestar/config/default";
import {ProtoBlock} from "@lodestar/fork-choice";
import {ForkName} from "@lodestar/params";
import {computeTimeAtSlot, CachedBeaconStateBellatrix} from "@lodestar/state-transition";
import {SyncState} from "../../../../../src/sync/interface.js";
import {ApiModules} from "../../../../../src/api/impl/types.js";
import {getValidatorApi} from "../../../../../src/api/impl/validator/index.js";
import {testLogger} from "../../../../utils/logger.js";
import {ApiImplTestModules, setupApiImplTestServer} from "../../../../__mocks__/apiMocks.js";
import {BeaconChain} from "../../../../../src/chain/index.js";
import {generateCachedBellatrixState} from "../../../../utils/state.js";
import {ExecutionEngineHttp} from "../../../../../src/execution/engine/http.js";
import {PayloadIdCache} from "../../../../../src/execution/engine/payloadIdCache.js";
import {toGraffitiBuffer} from "../../../../../src/util/graffiti.js";
import {BlockType, produceBlockBody} from "../../../../../src/chain/produceBlock/produceBlockBody.js";
import {generateProtoBlock} from "../../../../utils/typeGenerator.js";
import {ZERO_HASH_HEX} from "../../../../../src/constants/index.js";
import {OpPool} from "../../../../../src/chain/opPools/opPool.js";
import {AggregatedAttestationPool} from "../../../../../src/chain/opPools/index.js";
import {Eth1ForBlockProduction} from "../../../../../src/eth1/index.js";
import {BeaconProposerCache} from "../../../../../src/chain/beaconProposerCache.js";

describe("api/validator - produceBlockV2", function () {
  const logger = testLogger();

  let modules: ApiModules;
  let server: ApiImplTestModules;

  let chainStub: ApiImplTestModules["chainStub"];
  let forkChoiceStub: ApiImplTestModules["forkChoiceStub"];
  let executionEngineStub: MockedObject<ExecutionEngineHttp>;
  let opPoolStub: MockedObject<OpPool>;
  let aggregatedAttestationPoolStub: MockedObject<AggregatedAttestationPool>;
  let eth1Stub: MockedObject<Eth1ForBlockProduction>;
  let syncStub: ApiImplTestModules["syncStub"];
  let state: CachedBeaconStateBellatrix;
  let beaconProposerCacheStub: MockedObject<BeaconProposerCache>;

  beforeEach(() => {
    server = setupApiImplTestServer();
    chainStub = server.chainStub;
    forkChoiceStub = server.chainStub.forkChoice;
    executionEngineStub = server.chainStub.executionEngine;
    opPoolStub = server.chainStub.opPool;
    aggregatedAttestationPoolStub = server.chainStub.aggregatedAttestationPool;
    eth1Stub = server.chainStub.eth1;
    syncStub = server.syncStub;
    beaconProposerCacheStub = server.chainStub.beaconProposerCache;

    // server.chainStub.logger = logger;
    state = generateCachedBellatrixState();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("correctly pass feeRecipient to produceBlock", async function () {
    syncStub = server.syncStub;
    modules = {
      chain: server.chainStub,
      config,
      db: server.dbStub,
      logger,
      network: server.networkStub,
      sync: syncStub,
      metrics: null,
    };

    const fullBlock = ssz.bellatrix.BeaconBlock.defaultValue();
    const executionPayloadValue = ssz.Wei.defaultValue();
    const consensusBlockValue = ssz.Gwei.defaultValue();

    const currentSlot = 100000;
    vi.spyOn(server.chainStub.clock, "currentSlot", "get").mockReturnValue(currentSlot);
    vi.spyOn(syncStub, "state", "get").mockReturnValue(SyncState.Synced);

    // Set the node's state to way back from current slot
    const slot = 100000;
    const randaoReveal = fullBlock.body.randaoReveal;
    const graffiti = "a".repeat(32);
    const feeRecipient = "0xcccccccccccccccccccccccccccccccccccccccc";

    const api = getValidatorApi(modules);
    server.chainStub.produceBlock.mockResolvedValue({block: fullBlock, executionPayloadValue, consensusBlockValue});

    // check if expectedFeeRecipient is passed to produceBlock
    await api.produceBlockV2(slot, randaoReveal, graffiti, {feeRecipient});
    expect(server.chainStub.produceBlock).toBeCalledWith({
      randaoReveal,
      graffiti: toGraffitiBuffer(graffiti),
      slot,
      feeRecipient,
    });

    // check that no feeRecipient is passed to produceBlock so that produceBlockBody will
    // pick it from beaconProposerCache
    await api.produceBlockV2(slot, randaoReveal, graffiti);
    expect(server.chainStub.produceBlock).toBeCalledWith({
      randaoReveal,
      graffiti: toGraffitiBuffer(graffiti),
      slot,
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
    forkChoiceStub.getHead.mockReturnValue(generateProtoBlock({slot: headSlot}));

    opPoolStub.getSlashingsAndExits.mockReturnValue([[], [], [], []]);
    aggregatedAttestationPoolStub.getAttestationsForBlock.mockReturnValue([]);
    eth1Stub.getEth1DataAndDeposits.mockResolvedValue({eth1Data: ssz.phase0.Eth1Data.defaultValue(), deposits: []});
    forkChoiceStub.getJustifiedBlock.mockReturnValue({} as ProtoBlock);
    forkChoiceStub.getFinalizedBlock.mockReturnValue({} as ProtoBlock);
    (executionEngineStub as unknown as {payloadIdCache: PayloadIdCache}).payloadIdCache = new PayloadIdCache();

    executionEngineStub.notifyForkchoiceUpdate.mockResolvedValue("0x");
    executionEngineStub.getPayload.mockResolvedValue({
      executionPayload: ssz.bellatrix.ExecutionPayload.defaultValue(),
      executionPayloadValue,
    });

    // use fee recipient passed in produceBlockBody call for payload gen in engine notifyForkchoiceUpdate
    await produceBlockBody.call(chainStub as unknown as BeaconChain, BlockType.Full, state, {
      randaoReveal,
      graffiti: toGraffitiBuffer(graffiti),
      slot,
      feeRecipient,
      parentSlot: slot - 1,
      parentBlockRoot: fromHexString(ZERO_HASH_HEX),
      proposerIndex: 0,
      proposerPubKey: Uint8Array.from(Buffer.alloc(32, 1)),
    });

    expect(executionEngineStub.notifyForkchoiceUpdate).toBeCalledWith(
      ForkName.bellatrix,
      ZERO_HASH_HEX,
      ZERO_HASH_HEX,
      ZERO_HASH_HEX,
      {
        timestamp: computeTimeAtSlot(chainStub.config, state.slot, state.genesisTime),
        prevRandao: Uint8Array.from(Buffer.alloc(32, 0)),
        suggestedFeeRecipient: feeRecipient,
      }
    );

    // use fee recipient set in beaconProposerCacheStub if none passed
    beaconProposerCacheStub.getOrDefault.mockReturnValue("0x fee recipient address");
    await produceBlockBody.call(chainStub as unknown as BeaconChain, BlockType.Full, state, {
      randaoReveal,
      graffiti: toGraffitiBuffer(graffiti),
      slot,
      parentSlot: slot - 1,
      parentBlockRoot: fromHexString(ZERO_HASH_HEX),
      proposerIndex: 0,
      proposerPubKey: Uint8Array.from(Buffer.alloc(32, 1)),
    });

    expect(executionEngineStub.notifyForkchoiceUpdate).toBeCalledWith(
      ForkName.bellatrix,
      ZERO_HASH_HEX,
      ZERO_HASH_HEX,
      ZERO_HASH_HEX,
      {
        timestamp: computeTimeAtSlot(chainStub.config, state.slot, state.genesisTime),
        prevRandao: Uint8Array.from(Buffer.alloc(32, 0)),
        suggestedFeeRecipient: "0x fee recipient address",
      }
    );
  });
});
