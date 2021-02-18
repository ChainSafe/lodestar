import sinon, {SinonStubbedInstance} from "sinon";
import {expect} from "chai";

import {config} from "@chainsafe/lodestar-config/minimal";
import {phase0, createCachedValidatorsBeaconState} from "@chainsafe/lodestar-beacon-state-transition";

import {BeaconChain, ForkChoice, IBeaconChain} from "../../../../../../src/chain";
import {LocalClock} from "../../../../../../src/chain/clock";
import {FAR_FUTURE_EPOCH} from "../../../../../../src/constants";
import {IValidatorApi, ValidatorApi} from "../../../../../../src/api/impl/validator";
import {generateInitialMaxBalances} from "../../../../../utils/balances";
import {generateState} from "../../../../../utils/state";
import {StubbedBeaconDb} from "../../../../../utils/stub";
import {BeaconSync, IBeaconSync} from "../../../../../../src/sync";
import {generateValidators} from "../../../../../utils/validator";

describe("get proposers api impl", function () {
  const sandbox = sinon.createSandbox();

  let dbStub: StubbedBeaconDb,
    chainStub: SinonStubbedInstance<IBeaconChain>,
    syncStub: SinonStubbedInstance<IBeaconSync>;

  let api: IValidatorApi;

  beforeEach(function () {
    dbStub = new StubbedBeaconDb(sandbox, config);
    chainStub = sandbox.createStubInstance(BeaconChain);
    chainStub.clock = sandbox.createStubInstance(LocalClock);
    chainStub.forkChoice = sandbox.createStubInstance(ForkChoice);
    syncStub = sandbox.createStubInstance(BeaconSync);
    // @ts-ignore
    api = new ValidatorApi({}, {db: dbStub, chain: chainStub, sync: syncStub, config});
  });

  afterEach(function () {
    sandbox.restore();
  });

  it("should throw error when node is syncing", async function () {
    syncStub.isSynced.returns(false);
    syncStub.getSyncStatus.resolves({
      headSlot: BigInt(1000),
      syncDistance: BigInt(2000),
    });
    try {
      await api.getProposerDuties(1);
      expect.fail("Expect error here");
    } catch (e) {
      expect(e.message.startsWith("Node is syncing")).to.be.true;
    }
  });

  it("should throw error when node is stopped", async function () {
    syncStub.isSynced.returns(false);
    syncStub.getSyncStatus.throws("Node is stopped");
    try {
      await api.getProposerDuties(1);
      expect.fail("Expect error here");
    } catch (e) {
      expect(e.message.startsWith("Node is stopped")).to.be.true;
    }
  });

  it("should get proposers", async function () {
    syncStub.isSynced.returns(true);
    sandbox.stub(chainStub.clock, "currentEpoch").get(() => 0);
    sandbox.stub(chainStub.clock, "currentSlot").get(() => 0);
    dbStub.block.get.resolves({message: {stateRoot: Buffer.alloc(32)}} as any);
    const state = generateState({
      slot: 0,
      validators: generateValidators(25, {
        effectiveBalance: config.params.MAX_EFFECTIVE_BALANCE,
        activationEpoch: 0,
        exitEpoch: FAR_FUTURE_EPOCH,
      }),
      balances: generateInitialMaxBalances(config, 25),
    });
    const epochCtx = new phase0.EpochContext(config);
    epochCtx.loadState(state);
    chainStub.getHeadStateContextAtCurrentEpoch.resolves({
      state: createCachedValidatorsBeaconState(state),
      epochCtx,
    });
    sinon.stub(epochCtx, "getBeaconProposer").returns(1);
    const result = await api.getProposerDuties(0);
    expect(result.length).to.be.equal(config.params.SLOTS_PER_EPOCH);
  });
});
