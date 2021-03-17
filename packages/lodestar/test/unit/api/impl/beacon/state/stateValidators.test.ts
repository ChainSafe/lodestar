import {config} from "@chainsafe/lodestar-config/minimal";
import {Gwei} from "@chainsafe/lodestar-types";
import {CachedBeaconState, phase0} from "@chainsafe/lodestar-beacon-state-transition";
import {List} from "@chainsafe/ssz";
import {expect, use} from "chai";
import chaiAsPromised from "chai-as-promised";
import sinon, {SinonStubbedInstance, SinonStubbedMember} from "sinon";
import {BeaconStateApi} from "../../../../../../src/api/impl/beacon/state";
import * as stateApiUtils from "../../../../../../src/api/impl/beacon/state/utils";
import {generateState} from "../../../../../utils/state";
import {generateValidator, generateValidators} from "../../../../../utils/validator";
import {BeaconChain} from "../../../../../../src/chain";
import {StubbedBeaconDb} from "../../../../../utils/stub";
import {setupApiImplTestServer, ApiImplTestModules} from "../../index.test";
import {PubkeyIndexMap} from "@chainsafe/lodestar-beacon-state-transition/lib/phase0/fast";

use(chaiAsPromised);

describe("beacon api impl - state - validators", function () {
  let resolveStateIdStub: SinonStubbedMember<typeof stateApiUtils["resolveStateId"]>;
  let toValidatorResponseStub: SinonStubbedMember<typeof stateApiUtils["toValidatorResponse"]>;
  let dbStub: StubbedBeaconDb;
  let chainStub: SinonStubbedInstance<BeaconChain>;
  let server: ApiImplTestModules;

  before(function () {
    server = setupApiImplTestServer();
  });

  beforeEach(function () {
    resolveStateIdStub = server.sandbox.stub(stateApiUtils, "resolveStateId");
    toValidatorResponseStub = server.sandbox.stub(stateApiUtils, "toValidatorResponse");
    toValidatorResponseStub.returns({
      index: 1,
      balance: BigInt(3200000),
      status: phase0.ValidatorStatus.ACTIVE_ONGOING,
      validator: generateValidator(),
    });
    dbStub = server.dbStub;
    chainStub = server.chainStub;
  });

  afterEach(function () {
    server.sandbox.restore();
  });

  describe("get validators", function () {
    it("state not found", async function () {
      resolveStateIdStub.resolves(null);
      const api = new BeaconStateApi({}, {config, db: dbStub, chain: chainStub});
      await expect(api.getStateValidators("notfound")).to.be.rejectedWith("State not found");
    });

    it.skip("indices filter", async function () {
      resolveStateIdStub.resolves(generateState({validators: generateValidators(10)}));
      const api = new BeaconStateApi({}, {config, db: dbStub, chain: chainStub});
      const validators = api.getStateValidators("someState", {indices: [0, 1, 123]});
      expect((await validators).length).to.equal(2);
    });

    it.skip("status filter", async function () {
      resolveStateIdStub.resolves(generateState({validators: generateValidators(10)}));
      toValidatorResponseStub.onFirstCall().returns({
        index: 1,
        balance: BigInt(3200000),
        status: phase0.ValidatorStatus.EXITED_SLASHED,
        validator: generateValidator(),
      });
      const api = new BeaconStateApi({}, {config, db: dbStub, chain: chainStub});
      const validators = api.getStateValidators("someState", {statuses: [phase0.ValidatorStatus.ACTIVE_ONGOING]});
      expect((await validators).length).to.equal(9);
    });

    it("success", async function () {
      resolveStateIdStub.resolves(generateState({validators: generateValidators(10)}));
      const api = new BeaconStateApi({}, {config, db: dbStub, chain: chainStub});
      const validators = api.getStateValidators("someState");
      expect((await validators).length).to.equal(10);
    });
  });

  describe("get validator", function () {
    it("state not found", async function () {
      resolveStateIdStub.resolves(null);
      const api = new BeaconStateApi({}, {config, db: dbStub, chain: chainStub});
      await expect(api.getStateValidator("notfound", 1)).to.be.rejectedWith("State not found");
    });
    it("validator by index not found", async function () {
      resolveStateIdStub.resolves(generateState({validators: generateValidators(10)}));
      const api = new BeaconStateApi({}, {config, db: dbStub, chain: chainStub});
      await expect(api.getStateValidator("someState", 15)).to.be.rejectedWith("Validator not found");
    });
    it("validator by index found", async function () {
      resolveStateIdStub.resolves(generateState({validators: generateValidators(10)}));
      const api = new BeaconStateApi({}, {config, db: dbStub, chain: chainStub});
      expect(await api.getStateValidator("someState", 1)).to.not.be.null;
    });
    it("validator by root not found", async function () {
      resolveStateIdStub.resolves(generateState({validators: generateValidators(10)}));
      chainStub.getHeadState.returns({
        pubkey2index: ({
          get: () => undefined,
        } as unknown) as PubkeyIndexMap,
      } as CachedBeaconState<phase0.BeaconState>);
      const api = new BeaconStateApi({}, {config, db: dbStub, chain: chainStub});
      await expect(api.getStateValidator("someState", Buffer.alloc(32, 1))).to.be.rejectedWith("Validator not found");
    });
    it("validator by root found", async function () {
      resolveStateIdStub.resolves(generateState({validators: generateValidators(10)}));
      chainStub.getHeadState.returns({
        pubkey2index: ({
          get: () => 2,
        } as unknown) as PubkeyIndexMap,
      } as CachedBeaconState<phase0.BeaconState>);
      const api = new BeaconStateApi({}, {config, db: dbStub, chain: chainStub});
      expect(await api.getStateValidator("someState", Buffer.alloc(32, 1))).to.not.be.null;
    });
  });

  describe("get validators balances", function () {
    it("state not found", async function () {
      resolveStateIdStub.resolves(null);
      const api = new BeaconStateApi({}, {config, db: dbStub, chain: chainStub});
      await expect(api.getStateValidatorBalances("notfound")).to.be.rejectedWith("State not found");
    });

    it("indices filters", async function () {
      resolveStateIdStub.resolves(
        generateState({
          validators: generateValidators(10),
          balances: Array.from({length: 10}, () => BigInt(10)) as List<Gwei>,
        })
      );
      const pubkey2IndexStub = sinon.createStubInstance(phase0.fast.PubkeyIndexMap);
      pubkey2IndexStub.get.withArgs(Buffer.alloc(32, 1)).returns(3);
      pubkey2IndexStub.get.withArgs(Buffer.alloc(32, 2)).returns(25);
      chainStub.getHeadState.returns({
        pubkey2index: (pubkey2IndexStub as unknown) as phase0.fast.PubkeyIndexMap,
      } as CachedBeaconState<phase0.BeaconState>);
      const api = new BeaconStateApi({}, {config, db: dbStub, chain: chainStub});
      const balances = await api.getStateValidatorBalances("somestate", [
        1,
        24,
        Buffer.alloc(32, 1),
        Buffer.alloc(32, 2),
      ]);
      expect(balances.length).to.equal(2);
      expect(balances[0].index).to.equal(1);
      expect(balances[1].index).to.equal(3);
    });

    it("no filters", async function () {
      resolveStateIdStub.resolves(
        generateState({
          validators: generateValidators(10),
          balances: Array.from({length: 10}, () => BigInt(10)) as List<Gwei>,
        })
      );
      const api = new BeaconStateApi({}, {config, db: dbStub, chain: chainStub});
      const balances = await api.getStateValidatorBalances("somestate");
      expect(balances.length).to.equal(10);
      expect(balances[0].index).to.equal(0);
      expect(balances[0].balance.toString()).to.equal("10");
    });
  });
});
