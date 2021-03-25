import {expect} from "chai";
import sinon, {SinonStubbedInstance} from "sinon";

import {config} from "@chainsafe/lodestar-config/minimal";
import {createCachedBeaconState} from "@chainsafe/lodestar-beacon-state-transition";
import * as validatorStatusUtils from "@chainsafe/lodestar-beacon-state-transition/lib/util/validatorStatus";
import {ForkChoice} from "@chainsafe/lodestar-fork-choice";

import {BeaconChain} from "../../../../src/chain";
import {StateRegenerator} from "../../../../src/chain/regen";
import {StubbedBeaconDb, StubbedChain} from "../../../utils/stub";
import {generateValidators} from "../../../utils/validator";
import {generateInitialMaxBalances} from "../../../utils/balances";
import {generateState} from "../../../utils/state";
import {generateEmptySignedVoluntaryExit} from "../../../utils/attestation";
import {validateGossipVoluntaryExit} from "../../../../src/chain/validation/voluntaryExit";
import {VoluntaryExitErrorCode} from "../../../../src/chain/errors/voluntaryExitError";
import {SinonStubFn} from "../../../utils/types";
import {VoluntaryExitError} from "../../../../src/chain/errors";

describe("validate voluntary exit", () => {
  const sandbox = sinon.createSandbox();
  let dbStub: StubbedBeaconDb,
    isValidIncomingVoluntaryExitStub: SinonStubFn<typeof validatorStatusUtils["isValidVoluntaryExit"]>,
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
    const state = generateState(
      {
        genesisTime: Math.floor(Date.now() / 1000) - config.params.SECONDS_PER_SLOT,
        validators: generateValidators(config.params.MIN_GENESIS_ACTIVE_VALIDATOR_COUNT, {
          activationEpoch: 0,
          effectiveBalance: config.params.MAX_EFFECTIVE_BALANCE,
        }),
        balances: generateInitialMaxBalances(config),
      },
      config
    );
    regenStub.getCheckpointState.resolves(createCachedBeaconState(config, state));
    try {
      await validateGossipVoluntaryExit(config, chainStub, dbStub, voluntaryExit);
    } catch (error) {
      expect((error as VoluntaryExitError).type).to.have.property("code", VoluntaryExitErrorCode.EXIT_ALREADY_EXISTS);
    }
  });

  it("should return invalid Voluntary Exit - invalid", async () => {
    const voluntaryExit = generateEmptySignedVoluntaryExit();
    dbStub.voluntaryExit.has.resolves(false);
    const state = generateState(
      {
        genesisTime: Math.floor(Date.now() / 1000) - config.params.SECONDS_PER_SLOT,
        validators: generateValidators(config.params.MIN_GENESIS_ACTIVE_VALIDATOR_COUNT, {
          activationEpoch: 0,
          effectiveBalance: config.params.MAX_EFFECTIVE_BALANCE,
        }),
        balances: generateInitialMaxBalances(config),
      },
      config
    );
    regenStub.getCheckpointState.resolves(createCachedBeaconState(config, state));
    isValidIncomingVoluntaryExitStub.returns(false);
    try {
      await validateGossipVoluntaryExit(config, chainStub, dbStub, voluntaryExit);
    } catch (error) {
      expect((error as VoluntaryExitError).type).to.have.property("code", VoluntaryExitErrorCode.INVALID_EXIT);
    }
  });

  it("should return valid Voluntary Exit", async () => {
    const voluntaryExit = generateEmptySignedVoluntaryExit();
    dbStub.voluntaryExit.has.resolves(false);
    const state = generateState(
      {
        genesisTime: Math.floor(Date.now() / 1000) - config.params.SECONDS_PER_SLOT,
        validators: generateValidators(config.params.MIN_GENESIS_ACTIVE_VALIDATOR_COUNT, {
          activationEpoch: 0,
          effectiveBalance: config.params.MAX_EFFECTIVE_BALANCE,
        }),
        balances: generateInitialMaxBalances(config),
      },
      config
    );
    regenStub.getCheckpointState.resolves(createCachedBeaconState(config, state));
    isValidIncomingVoluntaryExitStub.returns(true);
    const validationTest = await validateGossipVoluntaryExit(config, chainStub, dbStub, voluntaryExit);
    expect(validationTest).to.not.throw;
  });
});
