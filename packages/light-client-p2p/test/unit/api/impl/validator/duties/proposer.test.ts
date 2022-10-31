import sinon, {SinonStubbedInstance} from "sinon";
import {use, expect} from "chai";
import chaiAsPromised from "chai-as-promised";
import {config} from "@lodestar/config/default";
import {ForkChoice} from "@lodestar/fork-choice";

import {ssz} from "@lodestar/types";
import {MAX_EFFECTIVE_BALANCE, SLOTS_PER_EPOCH} from "@lodestar/params";
import {LocalClock} from "../../../../../../src/chain/clock/index.js";
import {FAR_FUTURE_EPOCH} from "../../../../../../src/constants/index.js";
import {getValidatorApi} from "../../../../../../src/api/impl/validator/index.js";
import {ApiModules} from "../../../../../../src/api/impl/types.js";
import {generateState} from "../../../../../utils/state.js";
import {IBeaconSync} from "../../../../../../src/sync/index.js";
import {generateValidators} from "../../../../../utils/validator.js";
import {StubbedBeaconDb, StubbedChainMutable} from "../../../../../utils/stub/index.js";
import {setupApiImplTestServer, ApiImplTestModules} from "../../index.test.js";
import {testLogger} from "../../../../../utils/logger.js";
import {createCachedBeaconStateTest} from "../../../../../utils/cachedBeaconState.js";
import {zeroProtoBlock} from "../../../../../utils/mocks/chain/chain.js";

use(chaiAsPromised);

describe("get proposers api impl", function () {
  const logger = testLogger();

  let chainStub: StubbedChainMutable<"clock" | "forkChoice">,
    syncStub: SinonStubbedInstance<IBeaconSync>,
    dbStub: StubbedBeaconDb;

  let api: ReturnType<typeof getValidatorApi>;
  let server: ApiImplTestModules;
  let modules: ApiModules;

  beforeEach(function () {
    server = setupApiImplTestServer();
    chainStub = server.chainStub;
    syncStub = server.syncStub;
    chainStub.clock = server.sandbox.createStubInstance(LocalClock);
    const forkChoice = server.sandbox.createStubInstance(ForkChoice);
    chainStub.forkChoice = forkChoice;
    chainStub.getCanonicalBlockAtSlot.resolves(ssz.phase0.SignedBeaconBlock.defaultValue());
    dbStub = server.dbStub;
    modules = {
      chain: server.chainStub,
      config,
      db: server.dbStub,
      logger,
      network: server.networkStub,
      sync: syncStub,
      metrics: null,
    };
    api = getValidatorApi(modules);

    forkChoice.getHead.returns(zeroProtoBlock);
  });

  it("should get proposers for next epoch", async function () {
    syncStub.isSynced.returns(true);
    server.sandbox.stub(chainStub.clock, "currentEpoch").get(() => 0);
    server.sandbox.stub(chainStub.clock, "currentSlot").get(() => 0);
    dbStub.block.get.resolves({message: {stateRoot: Buffer.alloc(32)}} as any);
    const state = generateState(
      {
        slot: 0,
        validators: generateValidators(25, {
          effectiveBalance: MAX_EFFECTIVE_BALANCE,
          activationEpoch: 0,
          exitEpoch: FAR_FUTURE_EPOCH,
        }),
        balances: Array.from({length: 25}, () => MAX_EFFECTIVE_BALANCE),
      },
      config
    );

    const cachedState = createCachedBeaconStateTest(state, config);
    chainStub.getHeadStateAtCurrentEpoch.resolves(cachedState);
    const stubGetNextBeaconProposer = sinon.stub(cachedState.epochCtx, "getBeaconProposersNextEpoch");
    const stubGetBeaconProposer = sinon.stub(cachedState.epochCtx, "getBeaconProposer");
    stubGetNextBeaconProposer.returns([1]);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment,@typescript-eslint/no-unsafe-call,@typescript-eslint/no-unsafe-member-access
    const {data: result} = await api.getProposerDuties(1);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    expect(result.length).to.be.equal(SLOTS_PER_EPOCH, "result should be equals to slots per epoch");
    expect(stubGetNextBeaconProposer, "stubGetBeaconProposer function should not have been called").to.be.called;
    expect(stubGetBeaconProposer, "stubGetBeaconProposer function should have been called").not.to.be.called;
  });

  it("should have different proposer for current and next epoch", async function () {
    syncStub.isSynced.returns(true);
    server.sandbox.stub(chainStub.clock, "currentEpoch").get(() => 0);
    server.sandbox.stub(chainStub.clock, "currentSlot").get(() => 0);
    dbStub.block.get.resolves({message: {stateRoot: Buffer.alloc(32)}} as any);
    const state = generateState(
      {
        slot: 0,
        validators: generateValidators(25, {
          effectiveBalance: MAX_EFFECTIVE_BALANCE,
          activationEpoch: 0,
          exitEpoch: FAR_FUTURE_EPOCH,
        }),
        balances: Array.from({length: 25}, () => MAX_EFFECTIVE_BALANCE),
      },
      config
    );
    const cachedState = createCachedBeaconStateTest(state, config);
    chainStub.getHeadStateAtCurrentEpoch.resolves(cachedState);
    const stubGetBeaconProposer = sinon.stub(cachedState.epochCtx, "getBeaconProposer");
    stubGetBeaconProposer.returns(1);
    const {data: currentProposers} = await api.getProposerDuties(0);
    const {data: nextProposers} = await api.getProposerDuties(1);
    expect(currentProposers).to.not.deep.equal(nextProposers, "current proposer and next proposer should be different");
  });

  it("should not get proposers for more than one epoch in the future", async function () {
    syncStub.isSynced.returns(true);
    server.sandbox.stub(chainStub.clock, "currentEpoch").get(() => 0);
    server.sandbox.stub(chainStub.clock, "currentSlot").get(() => 0);
    dbStub.block.get.resolves({message: {stateRoot: Buffer.alloc(32)}} as any);
    const state = generateState(
      {
        slot: 0,
        validators: generateValidators(25, {
          effectiveBalance: MAX_EFFECTIVE_BALANCE,
          activationEpoch: 0,
          exitEpoch: FAR_FUTURE_EPOCH,
        }),
        balances: Array.from({length: 25}, () => MAX_EFFECTIVE_BALANCE),
      },
      config
    );
    const cachedState = createCachedBeaconStateTest(state, config);
    chainStub.getHeadStateAtCurrentEpoch.resolves(cachedState);
    const stubGetBeaconProposer = sinon.stub(cachedState.epochCtx, "getBeaconProposer");
    stubGetBeaconProposer.throws();
    expect(api.getProposerDuties(2), "calling getProposerDuties should throw").to.eventually.throws;
  });
});
