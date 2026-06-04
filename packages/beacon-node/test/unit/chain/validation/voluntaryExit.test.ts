import {afterEach, beforeAll, beforeEach, describe, it, vi} from "vitest";
import {SecretKey} from "@chainsafe/lodestar-z/blst";
import {BeaconConfig, createBeaconConfig, createChainForkConfig} from "@lodestar/config";
import {chainConfig} from "@lodestar/config/default";
import {DOMAIN_VOLUNTARY_EXIT, FAR_FUTURE_EPOCH, SLOTS_PER_EPOCH} from "@lodestar/params";
import {
  CachedBeaconStateAllForks,
  computeDomain,
  computeEpochAtSlot,
  computeSigningRoot,
} from "@lodestar/state-transition";
import {phase0, ssz} from "@lodestar/types";
import {VoluntaryExitErrorCode} from "../../../../src/chain/errors/voluntaryExitError.js";
import {validateGossipVoluntaryExit} from "../../../../src/chain/validation/voluntaryExit.js";
import {MockedBeaconChain, getMockedBeaconChain} from "../../../mocks/mockedBeaconChain.js";
import {createCachedBeaconStateTest} from "../../../utils/cachedBeaconState.js";
import {expectRejectedWithLodestarError} from "../../../utils/errors.js";
import {generateState} from "../../../utils/state.js";
import {TestBeaconStateView} from "../../../utils/stateView.js";

describe("validate voluntary exit", () => {
  let chainStub: MockedBeaconChain;
  let state: TestBeaconStateView;
  let originalState: CachedBeaconStateAllForks;
  let signedVoluntaryExit: phase0.SignedVoluntaryExit;
  let opPool: MockedBeaconChain["opPool"];
  let config: BeaconConfig;

  beforeAll(() => {
    const sk = SecretKey.fromKeygen(Buffer.alloc(32));

    const stateEmpty = ssz.phase0.BeaconState.defaultValue();

    // Validator has to be active for long enough
    stateEmpty.slot = chainConfig.SHARD_COMMITTEE_PERIOD * SLOTS_PER_EPOCH;

    // Add a validator that's active since genesis and ready to exit
    const validator = ssz.phase0.Validator.toViewDU({
      pubkey: sk.toPublicKey().toBytes(),
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
    const _state = generateState(stateEmpty, createChainForkConfig(chainConfig));
    config = createBeaconConfig(chainConfig, _state.genesisValidatorsRoot);

    originalState = createCachedBeaconStateTest(_state, config);
  });

  beforeEach(() => {
    state = new TestBeaconStateView(createCachedBeaconStateTest(originalState.clone(), config));
    chainStub = getMockedBeaconChain({config});
    opPool = chainStub.opPool;
    vi.spyOn(chainStub, "getHeadStateAtCurrentEpoch").mockResolvedValue(state);
    vi.spyOn(opPool, "hasSeenBlsToExecutionChange");
    vi.spyOn(opPool, "hasSeenVoluntaryExit");
    chainStub.bls.verifySignatureSets.mockResolvedValue(true);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("should return invalid Voluntary Exit - existing", async () => {
    const signedVoluntaryExitInvalidSig: phase0.SignedVoluntaryExit = {
      message: signedVoluntaryExit.message,
      signature: Buffer.alloc(96, 1),
    };

    // Return SignedVoluntaryExit known
    opPool.hasSeenVoluntaryExit.mockReturnValue(true);

    await expectRejectedWithLodestarError(
      validateGossipVoluntaryExit(chainStub, signedVoluntaryExitInvalidSig),
      VoluntaryExitErrorCode.ALREADY_EXISTS
    );
  });

  it("should return invalid Voluntary Exit - early epoch", async () => {
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
      VoluntaryExitErrorCode.EARLY_EPOCH
    );
  });

  it("should return invalid Voluntary Exit - inactive validator", async () => {
    const inactiveValidator: phase0.Validator = {
      ...state.getValidator(0),
      activationEpoch: FAR_FUTURE_EPOCH, // Make validator inactive
    };

    state.setValidator(0, inactiveValidator);

    vi.spyOn(chainStub, "getHeadStateAtCurrentEpoch").mockResolvedValue(state);

    await expectRejectedWithLodestarError(
      validateGossipVoluntaryExit(chainStub, signedVoluntaryExit),
      VoluntaryExitErrorCode.INACTIVE
    );
  });

  it("should return invalid Voluntary Exit - already exited", async () => {
    const currentEpoch = computeEpochAtSlot(state.slot);
    const exitedValidator: phase0.Validator = {
      ...state.getValidator(0),
      exitEpoch: currentEpoch + 10,
      activationEpoch: 0,
    };

    state.setValidator(0, exitedValidator);

    vi.spyOn(chainStub, "getHeadStateAtCurrentEpoch").mockResolvedValue(state);

    await expectRejectedWithLodestarError(
      validateGossipVoluntaryExit(chainStub, signedVoluntaryExit),
      VoluntaryExitErrorCode.ALREADY_EXITED
    );
  });

  it("should return invalid Voluntary Exit - short time active", async () => {
    const recentlyActivated: phase0.Validator = {
      ...state.getValidator(0),
      activationEpoch: computeEpochAtSlot(state.slot) - 1, // Recently activated
    };

    state.setValidator(0, recentlyActivated);

    vi.spyOn(chainStub, "getHeadStateAtCurrentEpoch").mockResolvedValue(state);

    await expectRejectedWithLodestarError(
      validateGossipVoluntaryExit(chainStub, signedVoluntaryExit),
      VoluntaryExitErrorCode.SHORT_TIME_ACTIVE
    );
  });

  it("should return invalid Voluntary Exit - invalid signature", async () => {
    const signedVoluntaryExitInvalidSig: phase0.SignedVoluntaryExit = {
      message: signedVoluntaryExit.message,
      signature: Buffer.alloc(96, 1),
    };

    opPool.hasSeenVoluntaryExit.mockReturnValue(false);

    chainStub.bls.verifySignatureSets.mockResolvedValue(false);

    await expectRejectedWithLodestarError(
      validateGossipVoluntaryExit(chainStub, signedVoluntaryExitInvalidSig),
      VoluntaryExitErrorCode.INVALID_SIGNATURE
    );
  });

  it("should return valid Voluntary Exit", async () => {
    await validateGossipVoluntaryExit(chainStub, signedVoluntaryExit);
  });
});
