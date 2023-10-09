import {describe, it, expect, beforeEach} from "vitest";
import sinon, {SinonStubbedInstance} from "sinon";
import {config} from "@lodestar/config/default";
import {ForkChoice} from "@lodestar/fork-choice";

import {ssz} from "@lodestar/types";
import {MAX_EFFECTIVE_BALANCE, SLOTS_PER_EPOCH} from "@lodestar/params";
import {Clock} from "../../../../../../src/util/clock.js";
import {FAR_FUTURE_EPOCH} from "../../../../../../src/constants/index.js";
import {getValidatorApi} from "../../../../../../src/api/impl/validator/index.js";
import {ApiModules} from "../../../../../../src/api/impl/types.js";
import {generateState} from "../../../../../utils/state.js";
import {IBeaconSync} from "../../../../../../src/sync/index.js";
import {generateValidators} from "../../../../../utils/validator.js";
import {StubbedBeaconDb, StubbedChainMutable} from "../../../../../utils/stub/index.js";
import {setupApiImplTestServer, ApiImplTestModules} from "../../../../../__mocks__/apiMocks.js";
import {testLogger} from "../../../../../utils/logger.js";
import {createCachedBeaconStateTest} from "../../../../../utils/cachedBeaconState.js";
import {zeroProtoBlock} from "../../../../../utils/mocks/chain.js";

describe.skip("get proposers api impl", function () {
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
    chainStub.clock = server.sandbox.createStubInstance(Clock);
    const forkChoice = server.sandbox.createStubInstance(ForkChoice);
    chainStub.forkChoice = forkChoice;
    chainStub.getCanonicalBlockAtSlot.mockResolvedValue({
      block: ssz.phase0.SignedBeaconBlock.defaultValue(),
      executionOptimistic: false,
    });
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

    forkChoice.getHead.mockReturnValue(zeroProtoBlock);
  });

  it("should get proposers for next epoch", async function () {
    syncStub.isSynced.mockReturnValue(true);
    server.sandbox.stub(chainStub.clock, "currentEpoch").get(() => 0);
    server.sandbox.stub(chainStub.clock, "currentSlot").get(() => 0);
    dbStub.block.get.mockResolvedValue({message: {stateRoot: Buffer.alloc(32)}} as any);
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
    chainStub.getHeadStateAtCurrentEpoch.mockResolvedValue(cachedState);
    const stubGetNextBeaconProposer = sinon.stub(cachedState.epochCtx, "getBeaconProposersNextEpoch");
    const stubGetBeaconProposer = sinon.stub(cachedState.epochCtx, "getBeaconProposer");
    stubGetNextBeaconProposer.mockReturnValue([1]);
    const {data: result} = await api.getProposerDuties(1);
    expect(result.length).toBe(SLOTS_PER_EPOCH);
    // "stubGetBeaconProposer function should not have been called"
    expect(stubGetNextBeaconProposer).toHaveBeenCalled();
    // "stubGetBeaconProposer function should have been called"
    expect(stubGetBeaconProposer).not.toHaveBeenCalled();
  });

  it("should have different proposer for current and next epoch", async function () {
    syncStub.isSynced.mockReturnValue(true);
    server.sandbox.stub(chainStub.clock, "currentEpoch").get(() => 0);
    server.sandbox.stub(chainStub.clock, "currentSlot").get(() => 0);
    dbStub.block.get.mockResolvedValue({message: {stateRoot: Buffer.alloc(32)}} as any);
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
    chainStub.getHeadStateAtCurrentEpoch.mockResolvedValue(cachedState);
    const stubGetBeaconProposer = sinon.stub(cachedState.epochCtx, "getBeaconProposer");
    stubGetBeaconProposer.mockReturnValue(1);
    const {data: currentProposers} = await api.getProposerDuties(0);
    const {data: nextProposers} = await api.getProposerDuties(1);
    expect(currentProposers).not.toEqual(nextProposers);
  });

  it("should not get proposers for more than one epoch in the future", async function () {
    syncStub.isSynced.mockReturnValue(true);
    server.sandbox.stub(chainStub.clock, "currentEpoch").get(() => 0);
    server.sandbox.stub(chainStub.clock, "currentSlot").get(() => 0);
    dbStub.block.get.mockResolvedValue({message: {stateRoot: Buffer.alloc(32)}} as any);
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
    chainStub.getHeadStateAtCurrentEpoch.mockResolvedValue(cachedState);
    const stubGetBeaconProposer = sinon.stub(cachedState.epochCtx, "getBeaconProposer");
    stubGetBeaconProposer.throws();
    await expect(api.getProposerDuties(2), "calling getProposerDuties should throw").rejects.toThrow();
  });
});
