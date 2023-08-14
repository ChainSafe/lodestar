import sinon, {SinonStubbedInstance} from "sinon";
import {use, expect} from "chai";
import chaiAsPromised from "chai-as-promised";
import {fromHexString} from "@chainsafe/ssz";
import {ssz} from "@lodestar/types";
import {config} from "@lodestar/config/default";
import {ForkChoice, ProtoBlock} from "@lodestar/fork-choice";
import {ChainForkConfig} from "@lodestar/config";
import {ForkName} from "@lodestar/params";
import {computeTimeAtSlot, CachedBeaconStateBellatrix} from "@lodestar/state-transition";
import {IBeaconSync, SyncState} from "../../../../../src/sync/interface.js";
import {ApiModules} from "../../../../../src/api/impl/types.js";
import {getValidatorApi} from "../../../../../src/api/impl/validator/index.js";
import {IClock} from "../../../../../src/util/clock.js";
import {testLogger} from "../../../../utils/logger.js";
import {ApiImplTestModules, setupApiImplTestServer} from "../index.test.js";
import {BeaconChain} from "../../../../../src/chain/index.js";
import {generateCachedBellatrixState} from "../../../../utils/state.js";
import {ExecutionEngineHttp} from "../../../../../src/execution/engine/http.js";
import {IExecutionEngine} from "../../../../../src/execution/engine/interface.js";
import {PayloadIdCache} from "../../../../../src/execution/engine/payloadIdCache.js";
import {StubbedChainMutable} from "../../../../utils/stub/index.js";
import {toGraffitiBuffer} from "../../../../../src/util/graffiti.js";
import {BlockType, produceBlockBody} from "../../../../../src/chain/produceBlock/produceBlockBody.js";
import {generateProtoBlock} from "../../../../utils/typeGenerator.js";
import {ZERO_HASH_HEX} from "../../../../../src/constants/index.js";
import {OpPool} from "../../../../../src/chain/opPools/opPool.js";
import {AggregatedAttestationPool} from "../../../../../src/chain/opPools/index.js";
import {Eth1ForBlockProduction, IEth1ForBlockProduction} from "../../../../../src/eth1/index.js";
import {BeaconProposerCache} from "../../../../../src/chain/beaconProposerCache.js";

use(chaiAsPromised);

type StubbedChain = StubbedChainMutable<"clock" | "forkChoice" | "logger">;

describe("api/validator - produceBlockV2", function () {
  const logger = testLogger();
  const sandbox = sinon.createSandbox();

  let modules: ApiModules;
  let server: ApiImplTestModules;

  let chainStub: StubbedChain;
  let forkChoiceStub: SinonStubbedInstance<ForkChoice> & ForkChoice;
  let executionEngineStub: SinonStubbedInstance<ExecutionEngineHttp> & ExecutionEngineHttp;
  let opPoolStub: SinonStubbedInstance<OpPool> & OpPool;
  let aggregatedAttestationPoolStub: SinonStubbedInstance<AggregatedAttestationPool> & AggregatedAttestationPool;
  let eth1Stub: SinonStubbedInstance<Eth1ForBlockProduction>;
  let syncStub: SinonStubbedInstance<IBeaconSync>;
  let state: CachedBeaconStateBellatrix;
  let beaconProposerCacheStub: SinonStubbedInstance<BeaconProposerCache> & BeaconProposerCache;

  beforeEach(() => {
    chainStub = sandbox.createStubInstance(BeaconChain) as StubbedChain;
    eth1Stub = sinon.createStubInstance(Eth1ForBlockProduction);
    chainStub.logger = logger;
    forkChoiceStub = sandbox.createStubInstance(ForkChoice) as SinonStubbedInstance<ForkChoice> & ForkChoice;
    chainStub.forkChoice = forkChoiceStub;

    executionEngineStub = sandbox.createStubInstance(ExecutionEngineHttp) as SinonStubbedInstance<ExecutionEngineHttp> &
      ExecutionEngineHttp;
    (chainStub as unknown as {executionEngine: IExecutionEngine}).executionEngine = executionEngineStub;

    opPoolStub = sandbox.createStubInstance(OpPool) as SinonStubbedInstance<OpPool> & OpPool;
    (chainStub as unknown as {opPool: OpPool}).opPool = opPoolStub;
    aggregatedAttestationPoolStub = sandbox.createStubInstance(
      AggregatedAttestationPool
    ) as SinonStubbedInstance<AggregatedAttestationPool> & AggregatedAttestationPool;
    (chainStub as unknown as {aggregatedAttestationPool: AggregatedAttestationPool}).aggregatedAttestationPool =
      aggregatedAttestationPoolStub;
    (chainStub as unknown as {eth1: IEth1ForBlockProduction}).eth1 = eth1Stub;
    (chainStub as unknown as {config: ChainForkConfig}).config = config as unknown as ChainForkConfig;

    executionEngineStub = sandbox.createStubInstance(ExecutionEngineHttp) as SinonStubbedInstance<ExecutionEngineHttp> &
      ExecutionEngineHttp;
    (chainStub as unknown as {executionEngine: IExecutionEngine}).executionEngine = executionEngineStub;

    beaconProposerCacheStub = sandbox.createStubInstance(
      BeaconProposerCache
    ) as SinonStubbedInstance<BeaconProposerCache> & BeaconProposerCache;
    (chainStub as unknown as {beaconProposerCache: BeaconProposerCache})["beaconProposerCache"] =
      beaconProposerCacheStub;

    state = generateCachedBellatrixState();
  });
  afterEach(() => {
    sandbox.restore();
  });

  it("correctly pass feeRecipient to produceBlock", async function () {
    server = setupApiImplTestServer();
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
    const blockValue = ssz.Wei.defaultValue();

    const currentSlot = 100000;
    server.chainStub.clock = {currentSlot} as IClock;
    sinon.replaceGetter(syncStub, "state", () => SyncState.Synced);

    // Set the node's state to way back from current slot
    const slot = 100000;
    const randaoReveal = fullBlock.body.randaoReveal;
    const graffiti = "a".repeat(32);
    const expectedFeeRecipient = "0xcccccccccccccccccccccccccccccccccccccccc";

    const api = getValidatorApi(modules);
    server.chainStub.produceBlock.resolves({block: fullBlock, blockValue});

    // check if expectedFeeRecipient is passed to produceBlock
    await api.produceBlockV2(slot, randaoReveal, graffiti, expectedFeeRecipient);
    expect(
      server.chainStub.produceBlock.calledWith({
        randaoReveal,
        graffiti: toGraffitiBuffer(graffiti),
        slot,
        feeRecipient: expectedFeeRecipient,
      })
    ).to.be.true;

    // check that no feeRecipient is passed to produceBlock so that produceBlockBody will
    // pick it from beaconProposerCache
    await api.produceBlockV2(slot, randaoReveal, graffiti);
    expect(
      server.chainStub.produceBlock.calledWith({
        randaoReveal,
        graffiti: toGraffitiBuffer(graffiti),
        slot,
        feeRecipient: undefined,
      })
    ).to.be.true;
  });

  it("correctly use passed feeRecipient in notifyForkchoiceUpdate", async () => {
    const fullBlock = ssz.bellatrix.BeaconBlock.defaultValue();
    const blockValue = ssz.Wei.defaultValue();
    const slot = 100000;
    const randaoReveal = fullBlock.body.randaoReveal;
    const graffiti = "a".repeat(32);
    const expectedFeeRecipient = "0xccccccccccccccccccccccccccccccccccccccaa";

    const headSlot = 0;
    forkChoiceStub.getHead.returns(generateProtoBlock({slot: headSlot}));

    opPoolStub.getSlashingsAndExits.returns([[], [], [], []]);
    aggregatedAttestationPoolStub.getAttestationsForBlock.returns([]);
    eth1Stub.getEth1DataAndDeposits.resolves({eth1Data: ssz.phase0.Eth1Data.defaultValue(), deposits: []});
    forkChoiceStub.getJustifiedBlock.returns({} as ProtoBlock);
    forkChoiceStub.getFinalizedBlock.returns({} as ProtoBlock);
    (executionEngineStub as unknown as {payloadIdCache: PayloadIdCache}).payloadIdCache = new PayloadIdCache();

    executionEngineStub.notifyForkchoiceUpdate.resolves("0x");
    executionEngineStub.getPayload.resolves({
      executionPayload: ssz.bellatrix.ExecutionPayload.defaultValue(),
      blockValue,
    });

    // use fee recipient passed in produceBlockBody call for payload gen in engine notifyForkchoiceUpdate
    await produceBlockBody.call(chainStub as unknown as BeaconChain, BlockType.Full, state, {
      randaoReveal,
      graffiti: toGraffitiBuffer(graffiti),
      slot,
      feeRecipient: expectedFeeRecipient,
      parentSlot: slot - 1,
      parentBlockRoot: fromHexString(ZERO_HASH_HEX),
      proposerIndex: 0,
      proposerPubKey: Uint8Array.from(Buffer.alloc(32, 1)),
    });

    expect(
      executionEngineStub.notifyForkchoiceUpdate.calledWith(
        ForkName.bellatrix,
        ZERO_HASH_HEX,
        ZERO_HASH_HEX,
        ZERO_HASH_HEX,
        {
          timestamp: computeTimeAtSlot(chainStub.config, state.slot, state.genesisTime),
          prevRandao: Uint8Array.from(Buffer.alloc(32, 0)),
          suggestedFeeRecipient: expectedFeeRecipient,
        }
      )
    ).to.be.true;

    // use fee recipient set in beaconProposerCacheStub if none passed
    beaconProposerCacheStub.getOrDefault.returns("0x fee recipient address");
    await produceBlockBody.call(chainStub as unknown as BeaconChain, BlockType.Full, state, {
      randaoReveal,
      graffiti: toGraffitiBuffer(graffiti),
      slot,
      parentSlot: slot - 1,
      parentBlockRoot: fromHexString(ZERO_HASH_HEX),
      proposerIndex: 0,
      proposerPubKey: Uint8Array.from(Buffer.alloc(32, 1)),
    });

    expect(
      executionEngineStub.notifyForkchoiceUpdate.calledWith(
        ForkName.bellatrix,
        ZERO_HASH_HEX,
        ZERO_HASH_HEX,
        ZERO_HASH_HEX,
        {
          timestamp: computeTimeAtSlot(chainStub.config, state.slot, state.genesisTime),
          prevRandao: Uint8Array.from(Buffer.alloc(32, 0)),
          suggestedFeeRecipient: "0x fee recipient address",
        }
      )
    ).to.be.true;
  });
});
