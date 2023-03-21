import sinon, {SinonStubbedInstance} from "sinon";

import {config} from "@lodestar/config/default";
import {
  CachedBeaconStateAllForks,
  computeEpochAtSlot,
  computeDomain,
  computeSigningRoot,
} from "@lodestar/state-transition";
import {ForkChoice} from "@lodestar/fork-choice";
import {phase0, ssz} from "@lodestar/types";

import {DOMAIN_VOLUNTARY_EXIT, FAR_FUTURE_EPOCH, SLOTS_PER_EPOCH} from "@lodestar/params";
import bls from "@chainsafe/bls";
import {PointFormat} from "@chainsafe/bls/types";
import {createBeaconConfig} from "@lodestar/config";
import {BeaconChain} from "../../../../src/chain/index.js";
import {StubbedChainMutable} from "../../../utils/stub/index.js";
import {generateState} from "../../../utils/state.js";
import {validateGossipVoluntaryExit} from "../../../../src/chain/validation/voluntaryExit.js";
import {VoluntaryExitErrorCode} from "../../../../src/chain/errors/voluntaryExitError.js";
import {OpPool} from "../../../../src/chain/opPools/index.js";
import {expectRejectedWithLodestarError} from "../../../utils/errors.js";
import {createCachedBeaconStateTest} from "../../../utils/cachedBeaconState.js";
import {BlsVerifierMock} from "../../../utils/mocks/bls.js";

type StubbedChain = StubbedChainMutable<"forkChoice" | "bls">;

describe("validate voluntary exit", () => {
  const sandbox = sinon.createSandbox();
  let chainStub: StubbedChain;
  let state: CachedBeaconStateAllForks;
  let signedVoluntaryExit: phase0.SignedVoluntaryExit;
  let opPool: OpPool & SinonStubbedInstance<OpPool>;

  before(() => {
    const sk = bls.SecretKey.fromKeygen();

    const stateEmpty = ssz.phase0.BeaconState.defaultValue();

    // Validator has to be active for long enough
    stateEmpty.slot = config.SHARD_COMMITTEE_PERIOD * SLOTS_PER_EPOCH;

    // Add a validator that's active since genesis and ready to exit
    const validator = ssz.phase0.Validator.toViewDU({
      pubkey: sk.toPublicKey().toBytes(PointFormat.compressed),
      withdrawalCredentials: Buffer.alloc(32, 0),
      effectiveBalance: 32e9,
      slashed: false,
      activationEligibilityEpoch: 0,
      activationEpoch: 0,
      exitEpoch: FAR_FUTURE_EPOCH,
      withdrawableEpoch: FAR_FUTURE_EPOCH,
    });
    stateEmpty.validators[0] = validator;

    const voluntaryExit = {
      epoch: 0,
      validatorIndex: 0,
    };
    const domain = computeDomain(
      DOMAIN_VOLUNTARY_EXIT,
      stateEmpty.fork.currentVersion,
      stateEmpty.genesisValidatorsRoot
    );
    const signingRoot = computeSigningRoot(ssz.phase0.VoluntaryExit, voluntaryExit, domain);
    signedVoluntaryExit = {message: voluntaryExit, signature: sk.sign(signingRoot).toBytes()};
    const _state = generateState(stateEmpty, config);

    state = createCachedBeaconStateTest(_state, createBeaconConfig(config, _state.genesisValidatorsRoot));
  });

  beforeEach(() => {
    chainStub = sandbox.createStubInstance(BeaconChain) as StubbedChain;
    chainStub.forkChoice = sandbox.createStubInstance(ForkChoice);
    opPool = sandbox.createStubInstance(OpPool) as OpPool & SinonStubbedInstance<OpPool>;
    (chainStub as {opPool: OpPool}).opPool = opPool;
    chainStub.getHeadStateAtCurrentEpoch.resolves(state);
    // TODO: Use actual BLS verification
    chainStub.bls = new BlsVerifierMock(true);
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("should return invalid Voluntary Exit - existing", async () => {
    const signedVoluntaryExitInvalidSig: phase0.SignedVoluntaryExit = {
      message: signedVoluntaryExit.message,
      signature: Buffer.alloc(96, 1),
    };

    // Return SignedVoluntaryExit known
    opPool.hasSeenVoluntaryExit.returns(true);

    await expectRejectedWithLodestarError(
      validateGossipVoluntaryExit(chainStub, signedVoluntaryExitInvalidSig),
      VoluntaryExitErrorCode.ALREADY_EXISTS
    );
  });

  it("should return invalid Voluntary Exit - invalid", async () => {
    const signedVoluntaryExitInvalid: phase0.SignedVoluntaryExit = {
      message: {
        // Force an invalid epoch
        epoch: computeEpochAtSlot(state.slot) + 1,
        validatorIndex: 0,
      },
      signature: Buffer.alloc(96, 1),
    };

    await expectRejectedWithLodestarError(
      validateGossipVoluntaryExit(chainStub, signedVoluntaryExitInvalid),
      VoluntaryExitErrorCode.INVALID
    );
  });

  it("should return valid Voluntary Exit", async () => {
    await validateGossipVoluntaryExit(chainStub, signedVoluntaryExit);
  });
});
