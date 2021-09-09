import sinon from "sinon";

import {config} from "@chainsafe/lodestar-config/default";
import {
  phase0,
  createCachedBeaconState,
  CachedBeaconState,
  computeEpochAtSlot,
  computeDomain,
  computeSigningRoot,
} from "@chainsafe/lodestar-beacon-state-transition";
import {ForkChoice} from "@chainsafe/lodestar-fork-choice";
import {allForks, ssz} from "@chainsafe/lodestar-types";

import {BeaconChain} from "../../../../src/chain";
import {StubbedBeaconDb, StubbedChain} from "../../../utils/stub";
import {generateState} from "../../../utils/state";
import {validateGossipVoluntaryExit} from "../../../../src/chain/validation/voluntaryExit";
import {VoluntaryExitErrorCode} from "../../../../src/chain/errors/voluntaryExitError";
import {expectRejectedWithLodestarError} from "../../../utils/errors";
import {DOMAIN_VOLUNTARY_EXIT, FAR_FUTURE_EPOCH, SLOTS_PER_EPOCH} from "@chainsafe/lodestar-params";
import {PointFormat, SecretKey} from "@chainsafe/bls";
import {createIBeaconConfig} from "@chainsafe/lodestar-config";

describe("validate voluntary exit", () => {
  const sandbox = sinon.createSandbox();
  let dbStub: StubbedBeaconDb;
  let chainStub: StubbedChain;
  let state: CachedBeaconState<allForks.BeaconState>;
  let signedVoluntaryExit: phase0.SignedVoluntaryExit;

  before(() => {
    const sk = SecretKey.fromKeygen();

    const stateEmpty = ssz.phase0.BeaconState.defaultTreeBacked();

    // Validator has to be active for long enough
    stateEmpty.slot = config.SHARD_COMMITTEE_PERIOD * SLOTS_PER_EPOCH;

    // Add a validator that's active since genesis and ready to exit
    stateEmpty.validators[0] = {
      pubkey: sk.toPublicKey().toBytes(PointFormat.compressed),
      withdrawalCredentials: Buffer.alloc(32, 0),
      effectiveBalance: 32e9,
      slashed: false,
      activationEligibilityEpoch: 0,
      activationEpoch: 0,
      exitEpoch: FAR_FUTURE_EPOCH,
      withdrawableEpoch: FAR_FUTURE_EPOCH,
    };

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

    state = createCachedBeaconState(createIBeaconConfig(config, _state.genesisValidatorsRoot), _state);
  });

  beforeEach(() => {
    chainStub = sandbox.createStubInstance(BeaconChain) as StubbedChain;
    chainStub.forkChoice = sandbox.createStubInstance(ForkChoice);
    // TODO: Use actual BLS verification
    chainStub.bls = {verifySignatureSets: async () => true};
    chainStub.getHeadState.returns(state);
    dbStub = new StubbedBeaconDb(sandbox);
    dbStub.voluntaryExit.has.resolves(false);
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
    dbStub.voluntaryExit.has.resolves(true);

    await expectRejectedWithLodestarError(
      validateGossipVoluntaryExit(chainStub, dbStub, signedVoluntaryExitInvalidSig),
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
      validateGossipVoluntaryExit(chainStub, dbStub, signedVoluntaryExitInvalid),
      VoluntaryExitErrorCode.INVALID
    );
  });

  it("should return valid Voluntary Exit", async () => {
    await validateGossipVoluntaryExit(chainStub, dbStub, signedVoluntaryExit);
  });
});
