import {config} from "@chainsafe/lodestar-config/default";
import {CachedBeaconStateAllForks, PubkeyIndexMap} from "@chainsafe/lodestar-beacon-state-transition";
import {List, toHexString} from "@chainsafe/ssz";
import {expect, use} from "chai";
import chaiAsPromised from "chai-as-promised";
import sinon, {SinonStubbedInstance, SinonStubbedMember} from "sinon";
import {getBeaconStateApi} from "../../../../../../src/api/impl/beacon/state";
import * as stateApiUtils from "../../../../../../src/api/impl/beacon/state/utils";
import {generateState} from "../../../../../utils/state";
import {generateValidator, generateValidators} from "../../../../../utils/validator";
import {BeaconChain} from "../../../../../../src/chain";
import {StubbedBeaconDb} from "../../../../../utils/stub";
import {setupApiImplTestServer, ApiImplTestModules} from "../../index.test";

use(chaiAsPromised);

const validatorId1 = toHexString(Buffer.alloc(48, 1));
const validatorId2 = toHexString(Buffer.alloc(48, 2));

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
      balance: 3200000,
      status: "active_ongoing",
      validator: generateValidator(),
    });
    dbStub = server.dbStub;
    chainStub = server.chainStub;
  });

  afterEach(function () {
    server.sandbox.restore();
  });

  describe("get validators", function () {
    it("indices filter", async function () {
      resolveStateIdStub.resolves(generateState({validators: generateValidators(10)}));
      chainStub.getHeadState.onCall(0).returns({
        pubkey2index: ({
          get: () => 0,
        } as unknown) as PubkeyIndexMap,
      } as CachedBeaconStateAllForks);
      const api = getBeaconStateApi({config, db: dbStub, chain: chainStub});
      const {data: validators} = await api.getStateValidators("someState", {indices: [0, 1, 123]});
      expect(validators.length).to.equal(2);
    });

    // TODO: Make a normal test without stubs
    it.skip("status filter", async function () {
      const numValidators = 10;
      resolveStateIdStub.resolves(generateState({validators: generateValidators(numValidators)}));
      toValidatorResponseStub.onFirstCall().returns({
        index: 1,
        balance: 3200000,
        status: "exited_slashed",
        validator: generateValidator(),
      });
      for (let i = 0; i < 10; i++) {
        chainStub.getHeadState.onCall(i).returns({
          pubkey2index: ({
            get: () => i,
          } as unknown) as PubkeyIndexMap,
        } as CachedBeaconStateAllForks);
      }
      const api = getBeaconStateApi({config, db: dbStub, chain: chainStub});
      const {data: validators} = await api.getStateValidators("someState", {
        statuses: ["pending_initialized"],
      });
      expect(validators.length).to.equal(9);
    });

    it("statuses and indices filters", async function () {
      const numValidators = 10;
      const validators = generateValidators(numValidators);
      validators[0].exitEpoch = 0;
      resolveStateIdStub.resolves(generateState({validators}));
      for (let i = 0; i < 10; i++) {
        chainStub.getHeadState.onCall(i).returns({
          pubkey2index: ({
            get: () => i,
          } as unknown) as PubkeyIndexMap,
        } as CachedBeaconStateAllForks);
      }
      const api = getBeaconStateApi({config, db: dbStub, chain: chainStub});
      const {data: stateValidators} = await api.getStateValidators("someState", {
        indices: [0, 1, 2, 123],
        statuses: ["pending_initialized"],
      });
      expect(stateValidators.length).to.equal(3);
    });

    it("success", async function () {
      resolveStateIdStub.resolves(generateState({validators: generateValidators(10)}));
      const api = getBeaconStateApi({config, db: dbStub, chain: chainStub});
      const {data: validators} = await api.getStateValidators("someState");
      expect(validators.length).to.equal(10);
    });
  });

  describe("get validator", function () {
    it("validator by index not found", async function () {
      resolveStateIdStub.resolves(generateState({validators: generateValidators(10)}));
      const api = getBeaconStateApi({config, db: dbStub, chain: chainStub});
      await expect(api.getStateValidator("someState", 15)).to.be.rejectedWith("Validator not found");
    });
    it("validator by index found", async function () {
      resolveStateIdStub.resolves(generateState({validators: generateValidators(10)}));
      const api = getBeaconStateApi({config, db: dbStub, chain: chainStub});
      expect(await api.getStateValidator("someState", 1)).to.not.be.null;
    });
    it.skip("validator by root not found", async function () {
      resolveStateIdStub.resolves(generateState({validators: generateValidators(10)}));
      chainStub.getHeadState.returns({
        pubkey2index: ({
          get: () => undefined,
        } as unknown) as PubkeyIndexMap,
      } as CachedBeaconStateAllForks);
      const api = getBeaconStateApi({config, db: dbStub, chain: chainStub});
      await expect(api.getStateValidator("someState", validatorId1)).to.be.rejectedWith("Validator not found");
    });
    it("validator by root found", async function () {
      resolveStateIdStub.resolves(generateState({validators: generateValidators(10)}));
      chainStub.getHeadState.returns({
        pubkey2index: ({
          get: () => 2,
        } as unknown) as PubkeyIndexMap,
      } as CachedBeaconStateAllForks);
      const api = getBeaconStateApi({config, db: dbStub, chain: chainStub});
      expect(await api.getStateValidator("someState", validatorId1)).to.not.be.null;
    });
  });

  describe("get validators balances", function () {
    it.skip("indices filters", async function () {
      resolveStateIdStub.resolves(
        generateState({
          validators: generateValidators(10),
          balances: Array.from({length: 10}, () => 10) as List<number>,
        })
      );
      const pubkey2IndexStub = sinon.createStubInstance(PubkeyIndexMap);
      pubkey2IndexStub.get.withArgs(validatorId1).returns(3);
      pubkey2IndexStub.get.withArgs(validatorId2).returns(25);
      chainStub.getHeadState.returns({
        pubkey2index: (pubkey2IndexStub as unknown) as PubkeyIndexMap,
      } as CachedBeaconStateAllForks);
      const api = getBeaconStateApi({config, db: dbStub, chain: chainStub});
      const {data: balances} = await api.getStateValidatorBalances("somestate", [1, 24, validatorId1, validatorId2]);
      expect(balances.length).to.equal(2);
      expect(balances[0].index).to.equal(1);
      expect(balances[1].index).to.equal(3);
    });

    it("no filters", async function () {
      resolveStateIdStub.resolves(
        generateState({
          validators: generateValidators(10),
          balances: Array.from({length: 10}, () => 10) as List<number>,
        })
      );
      const api = getBeaconStateApi({config, db: dbStub, chain: chainStub});
      const {data: balances} = await api.getStateValidatorBalances("somestate");
      expect(balances.length).to.equal(10);
      expect(balances[0].index).to.equal(0);
      expect(balances[0].balance.toString()).to.equal("10");
    });
  });
});
