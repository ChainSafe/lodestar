import {expect} from "chai";
import sinon from "sinon";

import {config} from "@chainsafe/lodestar-config/minimal";
import {generateEmptyProposerSlashing} from "@chainsafe/lodestar-beacon-state-transition/test/utils/slashings";
import * as validatorStatusUtils from "@chainsafe/lodestar-beacon-state-transition/lib/util/validatorStatus";
import {ForkChoice} from "@chainsafe/lodestar-fork-choice";

import {BeaconChain} from "../../../../src/chain";
import {StubbedBeaconDb, StubbedChain} from "../../../utils/stub";
import {generateCachedState} from "../../../utils/state";
import {ProposerSlashingError, ProposerSlashingErrorCode} from "../../../../src/chain/errors/proposerSlashingError";
import {validateGossipProposerSlashing} from "../../../../src/chain/validation/proposerSlashing";
import {SinonStubFn} from "../../../utils/types";

describe("validate proposer slashing", () => {
  const sandbox = sinon.createSandbox();
  let dbStub: StubbedBeaconDb,
    isValidIncomingProposerSlashingStub: SinonStubFn<typeof validatorStatusUtils["isValidProposerSlashing"]>,
    chainStub: StubbedChain;

  beforeEach(() => {
    isValidIncomingProposerSlashingStub = sandbox.stub(validatorStatusUtils, "isValidProposerSlashing");
    chainStub = sandbox.createStubInstance(BeaconChain) as StubbedChain;
    chainStub.forkChoice = sandbox.createStubInstance(ForkChoice);
    dbStub = new StubbedBeaconDb(sandbox);
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("should return invalid proposer slashing - existing", async () => {
    const slashing = generateEmptyProposerSlashing();
    dbStub.proposerSlashing.has.resolves(true);
    try {
      await validateGossipProposerSlashing(config, chainStub, dbStub, slashing);
    } catch (error) {
      expect((error as ProposerSlashingError).type).to.have.property(
        "code",
        ProposerSlashingErrorCode.SLASHING_ALREADY_EXISTS
      );
    }
  });

  it("should return invalid proposer slashing - invalid", async () => {
    const slashing = generateEmptyProposerSlashing();
    dbStub.proposerSlashing.has.resolves(false);
    const state = generateCachedState();
    chainStub.getHeadState.returns(state);
    isValidIncomingProposerSlashingStub.returns(false);
    try {
      await validateGossipProposerSlashing(config, chainStub, dbStub, slashing);
    } catch (error) {
      expect((error as ProposerSlashingError).type).to.have.property(
        "code",
        ProposerSlashingErrorCode.INVALID_SLASHING
      );
    }
  });

  it("should return valid proposer slashing", async () => {
    const slashing = generateEmptyProposerSlashing();
    dbStub.proposerSlashing.has.resolves(false);
    const state = generateCachedState();
    chainStub.getHeadState.returns(state);
    isValidIncomingProposerSlashingStub.returns(true);
    const validationTest = await validateGossipProposerSlashing(config, chainStub, dbStub, slashing);
    expect(validationTest).to.not.throw;
  });
});
