import {expect} from "chai";
import sinon from "sinon";

import {config} from "@chainsafe/lodestar-config/minimal";
import {generateEmptyAttesterSlashing} from "@chainsafe/lodestar-beacon-state-transition/test/utils/slashings";
import * as validatorStatusUtils from "@chainsafe/lodestar-beacon-state-transition/lib/util/validatorStatus";
import {ForkChoice} from "@chainsafe/lodestar-fork-choice";

import {BeaconChain} from "../../../../src/chain";
import {StubbedBeaconDb, StubbedChain} from "../../../utils/stub";
import {generateCachedState} from "../../../utils/state";
import {validateGossipAttesterSlashing} from "../../../../src/chain/validation/attesterSlashing";
import {AttesterSlashingErrorCode} from "../../../../src/chain/errors/attesterSlashingError";
import {SinonStubFn} from "../../../utils/types";
import {AttestationError} from "../../../../src/chain/errors";

describe("GossipMessageValidator", () => {
  const sandbox = sinon.createSandbox();
  let dbStub: StubbedBeaconDb,
    isValidIncomingAttesterSlashingStub: SinonStubFn<typeof validatorStatusUtils["isValidAttesterSlashing"]>,
    chainStub: StubbedChain;

  beforeEach(() => {
    isValidIncomingAttesterSlashingStub = sandbox.stub(validatorStatusUtils, "isValidAttesterSlashing");
    chainStub = sandbox.createStubInstance(BeaconChain) as StubbedChain;
    chainStub.forkChoice = sandbox.createStubInstance(ForkChoice);
    dbStub = new StubbedBeaconDb(sandbox);
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe("validate attester slashing", () => {
    it("should return invalid attester slashing - already exisits", async () => {
      const slashing = generateEmptyAttesterSlashing();
      dbStub.attesterSlashing.hasAll.resolves(true);
      try {
        await validateGossipAttesterSlashing(config, chainStub, dbStub, slashing);
      } catch (error) {
        expect((error as AttestationError).type).to.have.property(
          "code",
          AttesterSlashingErrorCode.SLASHING_ALREADY_EXISTS
        );
      }
    });

    it("should return invalid attester slashing - invalid", async () => {
      const slashing = generateEmptyAttesterSlashing();
      dbStub.attesterSlashing.hasAll.resolves(false);
      const state = generateCachedState();
      chainStub.getHeadState.returns(state);
      isValidIncomingAttesterSlashingStub.returns(false);
      try {
        await validateGossipAttesterSlashing(config, chainStub, dbStub, slashing);
      } catch (error) {
        expect((error as AttestationError).type).to.have.property("code", AttesterSlashingErrorCode.INVALID_SLASHING);
      }
    });

    it("should return valid attester slashing", async () => {
      const slashing = generateEmptyAttesterSlashing();
      dbStub.attesterSlashing.hasAll.resolves(false);
      const state = generateCachedState();
      chainStub.getHeadState.returns(state);
      isValidIncomingAttesterSlashingStub.returns(true);
      const validationTest = await validateGossipAttesterSlashing(config, chainStub, dbStub, slashing);
      expect(validationTest).to.not.throw;
    });
  });
});
