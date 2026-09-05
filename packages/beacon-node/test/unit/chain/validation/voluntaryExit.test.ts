import {afterEach, beforeAll, beforeEach, describe, expect, it, vi} from "vitest";
import {SecretKey} from "@chainsafe/lodestar-z/blst";
import {BeaconConfig, createBeaconConfig, createChainForkConfig} from "@lodestar/config";
import {chainConfig} from "@lodestar/config/default";
import {DOMAIN_VOLUNTARY_EXIT, FAR_FUTURE_EPOCH, SLOTS_PER_EPOCH, SYNC_COMMITTEE_SIZE} from "@lodestar/params";
import {
  CachedBeaconStateAllForks,
  VoluntaryExitValidity,
  computeDomain,
  computeEpochAtSlot,
  computeSigningRoot,
} from "@lodestar/state-transition";
import {phase0, ssz} from "@lodestar/types";
import {GossipAction} from "../../../../src/chain/errors/gossipValidation.js";
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
    vi.spyOn(chainStub.clock, "currentSlotWithGossipDisparity", "get").mockReturnValue(state.slot);
    opPool = chainStub.opPool;
    vi.spyOn(chainStub, "getHeadState").mockReturnValue(state);
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

    vi.spyOn(chainStub, "getHeadState").mockReturnValue(state);

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

    vi.spyOn(chainStub, "getHeadState").mockReturnValue(state);

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

    vi.spyOn(chainStub, "getHeadState").mockReturnValue(state);

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

  it("ignores future exits before reading the head state", async () => {
    const exit = {...signedVoluntaryExit, message: {epoch: FAR_FUTURE_EPOCH, validatorIndex: 0}};
    await expect(validateGossipVoluntaryExit(chainStub, exit)).rejects.toMatchObject({
      action: GossipAction.IGNORE,
      type: {code: VoluntaryExitErrorCode.EARLY_EPOCH},
    });
    expect(chainStub.getHeadState).not.toHaveBeenCalled();
  });

  it("ignores a validator who has already initiated exit", async () => {
    state.setValidator(0, {...state.getValidator(0), exitEpoch: computeEpochAtSlot(state.slot) + 1});
    await expect(validateGossipVoluntaryExit(chainStub, signedVoluntaryExit)).rejects.toMatchObject({
      action: GossipAction.IGNORE,
      type: {code: VoluntaryExitErrorCode.ALREADY_EXITED},
    });
    expect(chainStub.bls.verifySignatureSets).not.toHaveBeenCalled();
  });

  it("rejects an out-of-range validator index with a gossip error", async () => {
    const exit = {...signedVoluntaryExit, message: {epoch: 0, validatorIndex: state.validatorCount}};
    await expect(validateGossipVoluntaryExit(chainStub, exit)).rejects.toMatchObject({
      action: GossipAction.REJECT,
      type: {code: VoluntaryExitErrorCode.INVALID_VALIDATOR_INDEX},
    });
  });

  it("uses the head state for eligibility even when the clock is further ahead", async () => {
    state.setValidator(0, {...state.getValidator(0), activationEpoch: computeEpochAtSlot(state.slot) - 1});
    vi.spyOn(chainStub.clock, "currentSlotWithGossipDisparity", "get").mockReturnValue(state.slot * 2);
    await expectRejectedWithLodestarError(
      validateGossipVoluntaryExit(chainStub, signedVoluntaryExit),
      VoluntaryExitErrorCode.SHORT_TIME_ACTIVE
    );
    expect(chainStub.getHeadStateAtCurrentEpoch).not.toHaveBeenCalled();
  });

  it("accepts an exit epoch allowed by clock disparity even when the head is in the previous epoch", async () => {
    const nextEpoch = computeEpochAtSlot(state.slot) + 1;
    vi.spyOn(chainStub.clock, "currentSlotWithGossipDisparity", "get").mockReturnValue(nextEpoch * SLOTS_PER_EPOCH);
    const exit = {...signedVoluntaryExit, message: {epoch: nextEpoch, validatorIndex: 0}};
    await expect(validateGossipVoluntaryExit(chainStub, exit)).resolves.toBeUndefined();
    expect(chainStub.getHeadStateAtCurrentEpoch).not.toHaveBeenCalled();
  });

  it("does not apply the Electra pending-withdrawals block inclusion check to gossip", async () => {
    const electraConfig = createChainForkConfig({
      ...chainConfig,
      ALTAIR_FORK_EPOCH: 0,
      BELLATRIX_FORK_EPOCH: 0,
      CAPELLA_FORK_EPOCH: 0,
      DENEB_FORK_EPOCH: 0,
      ELECTRA_FORK_EPOCH: 0,
    });
    const electraState = ssz.electra.BeaconState.defaultViewDU();
    electraState.slot = state.slot;
    electraState.validators.push(ssz.phase0.Validator.toViewDU(state.getValidator(0)));
    electraState.balances.push(32e9);
    const syncCommittee = ssz.altair.SyncCommittee.toViewDU({
      pubkeys: Array.from({length: SYNC_COMMITTEE_SIZE}, () => state.getValidator(0).pubkey),
      aggregatePubkey: Buffer.alloc(48),
    });
    electraState.currentSyncCommittee = syncCommittee;
    electraState.nextSyncCommittee = syncCommittee.clone();
    electraState.pendingPartialWithdrawals.push(
      ssz.electra.PendingPartialWithdrawal.toViewDU({
        validatorIndex: 0,
        amount: 1n,
        withdrawableEpoch: computeEpochAtSlot(state.slot) + 1,
      })
    );
    electraState.commit();
    const head = new TestBeaconStateView(createCachedBeaconStateTest(electraState, electraConfig));
    chainStub.getHeadState.mockReturnValue(head);
    expect(head.getVoluntaryExitValidity(signedVoluntaryExit, false)).toBe(VoluntaryExitValidity.pendingWithdrawals);
    await expect(validateGossipVoluntaryExit(chainStub, signedVoluntaryExit)).resolves.toBeUndefined();
  });
});
