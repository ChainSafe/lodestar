import {config} from "@chainsafe/lodestar-config/lib/presets/minimal";
import sinon, {SinonStubbedInstance} from "sinon";
import {generateState} from "../../../../../utils/state";
import {generateValidators} from "../../../../../utils/validator";
import {expect} from "chai";
import {FAR_FUTURE_EPOCH} from "../../../../../../src/constants";
import {BeaconChain, IBeaconChain} from "../../../../../../src/chain";
import {IValidatorApi, ValidatorApi} from "../../../../../../src/api/impl/validator";
import {StubbedBeaconDb} from "../../../../../utils/stub";
import {EpochContext} from "@chainsafe/lodestar-beacon-state-transition";
import {BeaconSync, IBeaconSync} from "../../../../../../src/sync";

describe("get proposers api impl", function () {
  const sandbox = sinon.createSandbox();

  let dbStub: StubbedBeaconDb,
    chainStub: SinonStubbedInstance<IBeaconChain>,
    syncStub: SinonStubbedInstance<IBeaconSync>;

  let api: IValidatorApi;

  beforeEach(function () {
    dbStub = new StubbedBeaconDb(sandbox, config);
    chainStub = sandbox.createStubInstance(BeaconChain);
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

  it("should get proposers", async function () {
    syncStub.isSynced.returns(true);
    dbStub.block.get.resolves({message: {stateRoot: Buffer.alloc(32)}} as any);
    const state = generateState({
      slot: 0,
      validators: generateValidators(25, {
        effectiveBalance: config.params.MAX_EFFECTIVE_BALANCE,
        activationEpoch: 0,
        exitEpoch: FAR_FUTURE_EPOCH,
      }),
      balances: Array.from({length: 25}, () => config.params.MAX_EFFECTIVE_BALANCE),
    });
    const epochCtx = new EpochContext(config);
    epochCtx.loadState(state);
    chainStub.getHeadStateContext.resolves({
      state,
      epochCtx,
    });
    const result = await api.getProposerDuties(1);
    expect(result.length).to.be.equal(config.params.SLOTS_PER_EPOCH);
  });

  it("should get future proposers", async function () {
    syncStub.isSynced.returns(true);
    const state = generateState({
      slot: config.params.SLOTS_PER_EPOCH - 3,
      validators: generateValidators(25, {
        effectiveBalance: config.params.MAX_EFFECTIVE_BALANCE,
        activationEpoch: 0,
        exitEpoch: FAR_FUTURE_EPOCH,
      }),
      balances: Array.from({length: 25}, () => config.params.MAX_EFFECTIVE_BALANCE),
    });
    const epochCtx = new EpochContext(config);
    epochCtx.loadState(state);
    chainStub.getHeadStateContext.resolves({
      state,
      epochCtx,
    });

    const result = await api.getProposerDuties(2);
    expect(result.length).to.be.equal(config.params.SLOTS_PER_EPOCH);
  });
});
