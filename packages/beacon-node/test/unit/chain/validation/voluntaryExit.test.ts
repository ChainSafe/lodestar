import {afterEach, beforeAll, beforeEach, describe, expect, it, vi} from "vitest";
import {BeaconConfig, createBeaconConfig, createChainForkConfig} from "@lodestar/config";
import {chainConfig} from "@lodestar/config/default";
import {SecretKey} from "@lodestar/native/blst";
import {DOMAIN_VOLUNTARY_EXIT, FAR_FUTURE_EPOCH, SLOTS_PER_EPOCH} from "@lodestar/params";
import {
  CachedBeaconStateAllForks,
  VoluntaryExitValidity,
  computeDomain,
  computeEpochAtSlot,
  computeSigningRoot,
  computeStartSlotAtEpoch,
} from "@lodestar/state-transition";
import {phase0, ssz} from "@lodestar/types";
import {GossipAction} from "../../../../src/chain/errors/gossipValidation.js";
import {VoluntaryExitErrorCode} from "../../../../src/chain/errors/voluntaryExitError.js";
import {RegenCaller} from "../../../../src/chain/regen/index.js";
import {validateGossipVoluntaryExit} from "../../../../src/chain/validation/voluntaryExit.js";
import {MockedBeaconChain, getMockedBeaconChain} from "../../../mocks/mockedBeaconChain.js";
import {createCachedBeaconStateTest} from "../../../utils/cachedBeaconState.js";
import {generateState} from "../../../utils/state.js";
import {TestBeaconStateView} from "../../../utils/stateView.js";

async function expectGossipError(
  promise: Promise<unknown>,
  action: GossipAction,
  code: VoluntaryExitErrorCode
): Promise<void> {
  await expect(promise).rejects.toMatchObject({action, type: {code}});
}

describe("validate voluntary exit", () => {
  let chainStub: MockedBeaconChain;
  let state: TestBeaconStateView;
  let originalState: CachedBeaconStateAllForks;
  let nextEpochOriginalState: CachedBeaconStateAllForks;
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
    nextEpochOriginalState = createCachedBeaconStateTest(
      generateState(
        {...stateEmpty, slot: (chainConfig.SHARD_COMMITTEE_PERIOD + 1) * SLOTS_PER_EPOCH},
        createChainForkConfig(chainConfig)
      ),
      config
    );
  });

  beforeEach(() => {
    state = new TestBeaconStateView(createCachedBeaconStateTest(originalState.clone(), config));
    chainStub = getMockedBeaconChain({config});
    opPool = chainStub.opPool;
    vi.spyOn(chainStub.clock, "currentSlotWithGossipDisparity", "get").mockReturnValue(state.slot);
    vi.spyOn(chainStub, "getHeadStateAtEpoch").mockResolvedValue(state);
    vi.spyOn(opPool, "hasSeenBlsToExecutionChange");
    vi.spyOn(opPool, "hasSeenVoluntaryExit");
    chainStub.bls.verifySignatureSets.mockResolvedValue(true);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("should ignore Voluntary Exit - existing", async () => {
    const signedVoluntaryExitInvalidSig: phase0.SignedVoluntaryExit = {
      message: signedVoluntaryExit.message,
      signature: Buffer.alloc(96, 1),
    };

    // Return SignedVoluntaryExit known
    opPool.hasSeenVoluntaryExit.mockReturnValue(true);

    await expectGossipError(
      validateGossipVoluntaryExit(chainStub, signedVoluntaryExitInvalidSig),
      GossipAction.IGNORE,
      VoluntaryExitErrorCode.ALREADY_EXISTS
    );
  });

  it("should ignore Voluntary Exit - early epoch", async () => {
    const signedVoluntaryExitInvalid: phase0.SignedVoluntaryExit = {
      message: {
        // Force an invalid epoch
        epoch: computeEpochAtSlot(state.slot) + 1,
        validatorIndex: 0,
      },
      signature: Buffer.alloc(96, 1),
    };

    await expectGossipError(
      validateGossipVoluntaryExit(chainStub, signedVoluntaryExitInvalid),
      GossipAction.IGNORE,
      VoluntaryExitErrorCode.EARLY_EPOCH
    );
  });

  it("should ignore Voluntary Exit - early epoch before validator checks", async () => {
    vi.spyOn(state, "getVoluntaryExitValidity").mockReturnValue(VoluntaryExitValidity.inactive);
    const signedVoluntaryExitFutureEpoch: phase0.SignedVoluntaryExit = {
      message: {epoch: computeEpochAtSlot(state.slot) + 1, validatorIndex: state.validatorCount},
      signature: Buffer.alloc(96, 1),
    };

    await expectGossipError(
      validateGossipVoluntaryExit(chainStub, signedVoluntaryExitFutureEpoch),
      GossipAction.IGNORE,
      VoluntaryExitErrorCode.EARLY_EPOCH
    );
  });

  it("should reject Voluntary Exit - inactive validator", async () => {
    const inactiveValidator: phase0.Validator = {
      ...state.getValidator(0),
      activationEpoch: FAR_FUTURE_EPOCH, // Make validator inactive
    };

    state.setValidator(0, inactiveValidator);

    await expectGossipError(
      validateGossipVoluntaryExit(chainStub, signedVoluntaryExit),
      GossipAction.REJECT,
      VoluntaryExitErrorCode.INACTIVE
    );
  });

  it("should ignore Voluntary Exit - already exited", async () => {
    const currentEpoch = computeEpochAtSlot(state.slot);
    const exitedValidator: phase0.Validator = {
      ...state.getValidator(0),
      exitEpoch: currentEpoch + 10,
      activationEpoch: 0,
    };

    state.setValidator(0, exitedValidator);

    await expectGossipError(
      validateGossipVoluntaryExit(chainStub, signedVoluntaryExit),
      GossipAction.IGNORE,
      VoluntaryExitErrorCode.ALREADY_EXITED
    );
  });

  it("should ignore Voluntary Exit - exited validator", async () => {
    const currentEpoch = computeEpochAtSlot(state.slot);
    const exitedValidator: phase0.Validator = {
      ...state.getValidator(0),
      exitEpoch: currentEpoch - 1,
      activationEpoch: 0,
    };

    state.setValidator(0, exitedValidator);

    await expectGossipError(
      validateGossipVoluntaryExit(chainStub, signedVoluntaryExit),
      GossipAction.IGNORE,
      VoluntaryExitErrorCode.ALREADY_EXITED
    );
  });

  it("should reject Voluntary Exit - unknown validator index", async () => {
    const signedVoluntaryExitUnknownIndex: phase0.SignedVoluntaryExit = {
      message: {epoch: 0, validatorIndex: state.validatorCount},
      signature: signedVoluntaryExit.signature,
    };

    await expectGossipError(
      validateGossipVoluntaryExit(chainStub, signedVoluntaryExitUnknownIndex),
      GossipAction.REJECT,
      VoluntaryExitErrorCode.INACTIVE
    );
  });

  it("should ignore Voluntary Exit - pending withdrawals", async () => {
    vi.spyOn(state, "getVoluntaryExitValidity").mockReturnValue(VoluntaryExitValidity.pendingWithdrawals);

    await expectGossipError(
      validateGossipVoluntaryExit(chainStub, signedVoluntaryExit),
      GossipAction.IGNORE,
      VoluntaryExitErrorCode.PENDING_WITHDRAWALS
    );
  });

  it("should reject Voluntary Exit - short time active", async () => {
    const recentlyActivated: phase0.Validator = {
      ...state.getValidator(0),
      activationEpoch: computeEpochAtSlot(state.slot) - 1, // Recently activated
    };

    state.setValidator(0, recentlyActivated);

    await expectGossipError(
      validateGossipVoluntaryExit(chainStub, signedVoluntaryExit),
      GossipAction.REJECT,
      VoluntaryExitErrorCode.SHORT_TIME_ACTIVE
    );
  });

  it("should reject Voluntary Exit - invalid signature", async () => {
    const signedVoluntaryExitInvalidSig: phase0.SignedVoluntaryExit = {
      message: signedVoluntaryExit.message,
      signature: Buffer.alloc(96, 1),
    };

    opPool.hasSeenVoluntaryExit.mockReturnValue(false);

    chainStub.bls.verifySignatureSets.mockResolvedValue(false);

    await expectGossipError(
      validateGossipVoluntaryExit(chainStub, signedVoluntaryExitInvalidSig),
      GossipAction.REJECT,
      VoluntaryExitErrorCode.INVALID_SIGNATURE
    );
  });

  it("should return valid Voluntary Exit", async () => {
    await validateGossipVoluntaryExit(chainStub, signedVoluntaryExit);
  });

  it("should return valid Voluntary Exit - next epoch within clock disparity", async () => {
    const nextEpoch = computeEpochAtSlot(state.slot) + 1;
    vi.spyOn(chainStub.clock, "currentSlotWithGossipDisparity", "get").mockReturnValue(
      computeStartSlotAtEpoch(nextEpoch)
    );
    const nextEpochState = new TestBeaconStateView(createCachedBeaconStateTest(nextEpochOriginalState.clone(), config));
    vi.spyOn(chainStub, "getHeadStateAtEpoch").mockResolvedValue(nextEpochState);
    const signedVoluntaryExitNextEpoch: phase0.SignedVoluntaryExit = {
      message: {epoch: nextEpoch, validatorIndex: 0},
      signature: signedVoluntaryExit.signature,
    };

    await validateGossipVoluntaryExit(chainStub, signedVoluntaryExitNextEpoch);
    expect(chainStub.getHeadStateAtEpoch).toHaveBeenCalledWith(nextEpoch, RegenCaller.validateGossipVoluntaryExit);
  });
});
