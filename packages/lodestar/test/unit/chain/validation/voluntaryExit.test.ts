import {expect} from "chai";
import sinon, {SinonStub, SinonStubbedInstance} from "sinon";

import {config} from "@chainsafe/lodestar-config/minimal";
import * as validatorStatusUtils from "@chainsafe/lodestar-beacon-state-transition/lib/util/validatorStatus";
import {ForkChoice} from "@chainsafe/lodestar-fork-choice";

import {BeaconChain} from "../../../../src/chain";
import {StateRegenerator} from "../../../../src/chain/regen";
import {StubbedBeaconDb, StubbedChain} from "../../../utils/stub";
import {generateCachedState} from "../../../utils/state";
import {generateEmptySignedVoluntaryExit} from "../../../utils/attestation";
import {validateGossipVoluntaryExit} from "../../../../src/chain/validation/voluntaryExit";
import {VoluntaryExitErrorCode} from "../../../../src/chain/errors/voluntaryExitError";

describe("validate voluntary exit", () => {
  const sandbox = sinon.createSandbox();
  let dbStub: StubbedBeaconDb,
    isValidIncomingVoluntaryExitStub: SinonStub,
    chainStub: StubbedChain,
    regenStub: SinonStubbedInstance<StateRegenerator>;

  beforeEach(() => {
    isValidIncomingVoluntaryExitStub = sandbox.stub(validatorStatusUtils, "isValidVoluntaryExit");
    chainStub = sandbox.createStubInstance(BeaconChain) as StubbedChain;
    chainStub.forkChoice = sandbox.createStubInstance(ForkChoice);
    regenStub = chainStub.regen = sandbox.createStubInstance(StateRegenerator);
    dbStub = new StubbedBeaconDb(sandbox);
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("should return invalid Voluntary Exit - existing", async () => {
    const voluntaryExit = generateEmptySignedVoluntaryExit();
    dbStub.voluntaryExit.has.resolves(true);
    try {
      await validateGossipVoluntaryExit(config, chainStub, dbStub, voluntaryExit);
    } catch (error) {
      expect(error.type).to.have.property("code", VoluntaryExitErrorCode.EXIT_ALREADY_EXISTS);
    }
  });

  it("should return invalid Voluntary Exit - invalid", async () => {
    const voluntaryExit = generateEmptySignedVoluntaryExit();
    dbStub.voluntaryExit.has.resolves(false);
    const cachedState = generateCachedState();
    regenStub.getCheckpointState.resolves(cachedState);
    isValidIncomingVoluntaryExitStub.returns(false);
    try {
      await validateGossipVoluntaryExit(config, chainStub, dbStub, voluntaryExit);
    } catch (error) {
      expect(error.type).to.have.property("code", VoluntaryExitErrorCode.INVALID_EXIT);
    }
  });

  it("should return valid Voluntary Exit", async () => {
    const voluntaryExit = generateEmptySignedVoluntaryExit();
    dbStub.voluntaryExit.has.resolves(false);
    const cachedState = generateCachedState();
    regenStub.getCheckpointState.resolves(cachedState);
    isValidIncomingVoluntaryExitStub.returns(true);
    const validationTest = await validateGossipVoluntaryExit(config, chainStub, dbStub, voluntaryExit);
    expect(validationTest).to.not.throw;
  });
});
