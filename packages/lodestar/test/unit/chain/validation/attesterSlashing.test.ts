import {expect} from "chai";
import sinon from "sinon";

import {config} from "@chainsafe/lodestar-config/minimal";
import {generateEmptyAttesterSlashing} from "@chainsafe/lodestar-beacon-state-transition/test/utils/slashings";
import {phase0} from "@chainsafe/lodestar-beacon-state-transition";
import {ForkChoice} from "@chainsafe/lodestar-fork-choice";

import {BeaconChain} from "../../../../src/chain";
import {StubbedBeaconDb, StubbedChain} from "../../../utils/stub";
import {generateCachedState} from "../../../utils/state";
import {validateGossipAttesterSlashing} from "../../../../src/chain/validation/attesterSlashing";
import {AttesterSlashingErrorCode} from "../../../../src/chain/errors/attesterSlashingError";
import {SinonStubFn} from "../../../utils/types";
import {expectRejectedWithLodestarError} from "../../../utils/errors";

describe("GossipMessageValidator", () => {
  const sandbox = sinon.createSandbox();
  let dbStub: StubbedBeaconDb,
    assertValidAttesterSlashing: SinonStubFn<typeof phase0["assertValidAttesterSlashing"]>,
    chainStub: StubbedChain;

  beforeEach(() => {
    assertValidAttesterSlashing = sandbox.stub(phase0, "assertValidAttesterSlashing");
    chainStub = sandbox.createStubInstance(BeaconChain) as StubbedChain;
    chainStub.forkChoice = sandbox.createStubInstance(ForkChoice);
    chainStub.bls = {verifySignatureSets: async () => true};
    dbStub = new StubbedBeaconDb(sandbox);
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe("validate attester slashing", () => {
    it("should return invalid attester slashing - already exisits", async () => {
      const slashing = generateEmptyAttesterSlashing();
      dbStub.attesterSlashing.hasAll.resolves(true);

      await expectRejectedWithLodestarError(
        validateGossipAttesterSlashing(config, chainStub, dbStub, slashing),
        AttesterSlashingErrorCode.SLASHING_ALREADY_EXISTS
      );
    });

    it("should return invalid attester slashing - invalid", async () => {
      const slashing = generateEmptyAttesterSlashing();
      dbStub.attesterSlashing.hasAll.resolves(false);
      const state = generateCachedState();
      chainStub.getHeadState.returns(state);
      assertValidAttesterSlashing.throws(Error("Invalid"));

      await expectRejectedWithLodestarError(
        validateGossipAttesterSlashing(config, chainStub, dbStub, slashing),
        AttesterSlashingErrorCode.INVALID_SLASHING
      );
    });

    it("should return valid attester slashing", async () => {
      const slashing = generateEmptyAttesterSlashing();
      dbStub.attesterSlashing.hasAll.resolves(false);
      const state = generateCachedState();
      chainStub.getHeadState.returns(state);
      assertValidAttesterSlashing.returns();
      const validationTest = await validateGossipAttesterSlashing(config, chainStub, dbStub, slashing);
      expect(validationTest).to.not.throw;
    });
  });
});
