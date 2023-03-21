import sinon from "sinon";
import {SinonStubbedInstance} from "sinon";
import {altair, Epoch, Slot} from "@lodestar/types";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {createChainForkConfig, defaultChainConfig} from "@lodestar/config";
import {BeaconChain} from "../../../../src/chain/index.js";
import {LocalClock} from "../../../../src/chain/clock/index.js";
import {SyncCommitteeErrorCode} from "../../../../src/chain/errors/syncCommitteeError.js";
import {validateGossipSyncCommittee} from "../../../../src/chain/validation/syncCommittee.js";
import {expectRejectedWithLodestarError} from "../../../utils/errors.js";
import {generateCachedAltairState} from "../../../utils/state.js";
import {SeenSyncCommitteeMessages} from "../../../../src/chain/seenCache/index.js";
import {BlsVerifierMock} from "../../../utils/mocks/bls.js";
import {StubbedChainMutable} from "../../../utils/stub/index.js";
import {ZERO_HASH} from "../../../../src/constants/constants.js";

type StubbedChain = StubbedChainMutable<"clock" | "bls">;

// https://github.com/ethereum/consensus-specs/blob/v1.1.10/specs/altair/p2p-interface.md
describe("Sync Committee Signature validation", function () {
  const sandbox = sinon.createSandbox();
  let chain: StubbedChain;
  let clockStub: SinonStubbedInstance<LocalClock>;
  // let computeSubnetsForSyncCommitteeStub: SinonStubFn<typeof syncCommitteeUtils["computeSubnetsForSyncCommittee"]>;
  let altairForkEpochBk: Epoch;
  const altairForkEpoch = 2020;
  const currentSlot = SLOTS_PER_EPOCH * (altairForkEpoch + 1);
  // eslint-disable-next-line @typescript-eslint/naming-convention
  const config = createChainForkConfig(Object.assign({}, defaultChainConfig, {ALTAIR_FORK_EPOCH: altairForkEpoch}));
  // all validators have same pubkey
  const validatorIndexInSyncCommittee = 15;

  before(async function () {
    altairForkEpochBk = config.ALTAIR_FORK_EPOCH;
    config.ALTAIR_FORK_EPOCH = altairForkEpoch;
  });

  after(function () {
    config.ALTAIR_FORK_EPOCH = altairForkEpochBk;
  });

  beforeEach(function () {
    chain = sandbox.createStubInstance(BeaconChain);
    (chain as {
      seenSyncCommitteeMessages: SeenSyncCommitteeMessages;
    }).seenSyncCommitteeMessages = new SeenSyncCommitteeMessages();
    clockStub = sandbox.createStubInstance(LocalClock);
    chain.clock = clockStub;
    clockStub.isCurrentSlotGivenGossipDisparity.returns(true);
  });

  afterEach(function () {
    sandbox.restore();
  });

  it("should throw error - the signature's slot is in the past", async function () {
    clockStub.isCurrentSlotGivenGossipDisparity.returns(false);
    sandbox.stub(clockStub, "currentSlot").get(() => 100);

    const syncCommittee = getSyncCommitteeSignature(1, 0);
    await expectRejectedWithLodestarError(
      validateGossipSyncCommittee(chain, syncCommittee, 0),
      SyncCommitteeErrorCode.NOT_CURRENT_SLOT
    );
  });

  it("should throw error - there has been another valid sync committee signature for the declared slot", async function () {
    const syncCommittee = getSyncCommitteeSignature(currentSlot, validatorIndexInSyncCommittee);
    const headState = generateCachedAltairState({slot: currentSlot}, altairForkEpoch);
    chain.getHeadState.returns(headState);
    chain.seenSyncCommitteeMessages.isKnown = () => true;
    await expectRejectedWithLodestarError(
      validateGossipSyncCommittee(chain, syncCommittee, 0),
      SyncCommitteeErrorCode.SYNC_COMMITTEE_AGGREGATOR_ALREADY_KNOWN
    );
  });

  it("should throw error - the validator is not part of the current sync committee", async function () {
    const syncCommittee = getSyncCommitteeSignature(currentSlot, 100);
    const headState = generateCachedAltairState({slot: currentSlot}, altairForkEpoch);
    chain.getHeadState.returns(headState);

    await expectRejectedWithLodestarError(
      validateGossipSyncCommittee(chain, syncCommittee, 0),
      SyncCommitteeErrorCode.VALIDATOR_NOT_IN_SYNC_COMMITTEE
    );
  });

  /**
   * Skip this spec check: [REJECT] The subnet_id is correct, i.e. subnet_id in compute_subnets_for_sync_committee(state, sync_committee_signature.validator_index)
   * because it's the same to VALIDATOR_NOT_IN_SYNC_COMMITTEE
   */
  it.skip("should throw error - incorrect subnet", async function () {
    const syncCommittee = getSyncCommitteeSignature(currentSlot, 1);
    const headState = generateCachedAltairState({slot: currentSlot}, altairForkEpoch);
    chain.getHeadState.returns(headState);
    await expectRejectedWithLodestarError(
      validateGossipSyncCommittee(chain, syncCommittee, 0),
      SyncCommitteeErrorCode.INVALID_SUBCOMMITTEE_INDEX
    );
  });

  it("should throw error - invalid signature", async function () {
    const syncCommittee = getSyncCommitteeSignature(currentSlot, validatorIndexInSyncCommittee);
    const headState = generateCachedAltairState({slot: currentSlot}, altairForkEpoch);

    chain.getHeadState.returns(headState);
    chain.bls = new BlsVerifierMock(false);
    await expectRejectedWithLodestarError(
      validateGossipSyncCommittee(chain, syncCommittee, 0),
      SyncCommitteeErrorCode.INVALID_SIGNATURE
    );
  });
});

function getSyncCommitteeSignature(slot: Slot, validatorIndex: number): altair.SyncCommitteeMessage {
  return {
    slot,
    beaconBlockRoot: ZERO_HASH,
    validatorIndex,
    signature: ZERO_HASH,
  };
}
