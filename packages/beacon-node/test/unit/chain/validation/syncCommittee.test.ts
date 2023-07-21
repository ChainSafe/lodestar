import sinon from "sinon";
import {SinonStubbedInstance} from "sinon";
import {expect} from "chai";
import {toHexString} from "@chainsafe/ssz";
import {altair, Epoch, Slot} from "@lodestar/types";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {createChainForkConfig, defaultChainConfig} from "@lodestar/config";
import {ForkChoice, IForkChoice} from "@lodestar/fork-choice";
import {BeaconChain} from "../../../../src/chain/index.js";
import {Clock} from "../../../../src/util/clock.js";
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
  let clockStub: SinonStubbedInstance<Clock>;
  let forkchoiceStub: SinonStubbedInstance<ForkChoice>;
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
    chain = sandbox.createStubInstance(BeaconChain) as typeof chain;
    (
      chain as {
        seenSyncCommitteeMessages: SeenSyncCommitteeMessages;
      }
    ).seenSyncCommitteeMessages = new SeenSyncCommitteeMessages();
    clockStub = sandbox.createStubInstance(Clock);
    chain.clock = clockStub;
    clockStub.isCurrentSlotGivenGossipDisparity.returns(true);
    forkchoiceStub = sandbox.createStubInstance(ForkChoice);
    (chain as {forkChoice: IForkChoice}).forkChoice = forkchoiceStub;
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

  it("should throw error - messageRoot is same to prevRoot", async function () {
    const syncCommittee = getSyncCommitteeSignature(currentSlot, validatorIndexInSyncCommittee);
    const headState = generateCachedAltairState({slot: currentSlot}, altairForkEpoch);
    chain.getHeadState.returns(headState);
    chain.seenSyncCommitteeMessages.get = () => toHexString(syncCommittee.beaconBlockRoot);
    await expectRejectedWithLodestarError(
      validateGossipSyncCommittee(chain, syncCommittee, 0),
      SyncCommitteeErrorCode.SYNC_COMMITTEE_MESSAGE_KNOWN
    );
  });

  it("should throw error - messageRoot is different to prevRoot but not forkchoice head", async function () {
    const syncCommittee = getSyncCommitteeSignature(currentSlot, validatorIndexInSyncCommittee);
    const headState = generateCachedAltairState({slot: currentSlot}, altairForkEpoch);
    chain.getHeadState.returns(headState);
    const prevRoot = "0x1234";
    chain.seenSyncCommitteeMessages.get = () => prevRoot;
    forkchoiceStub.getHeadRoot.returns(prevRoot);
    await expectRejectedWithLodestarError(
      validateGossipSyncCommittee(chain, syncCommittee, 0),
      SyncCommitteeErrorCode.SYNC_COMMITTEE_MESSAGE_KNOWN
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

  it("should pass, no prev root", async function () {
    const syncCommittee = getSyncCommitteeSignature(currentSlot, validatorIndexInSyncCommittee);
    const subnet = 3;
    const {slot, validatorIndex} = syncCommittee;
    const headState = generateCachedAltairState({slot: currentSlot}, altairForkEpoch);

    chain.getHeadState.returns(headState);
    chain.bls = new BlsVerifierMock(true);
    expect(chain.seenSyncCommitteeMessages.get(slot, subnet, validatorIndex), "should be null").to.be.null;
    await validateGossipSyncCommittee(chain, syncCommittee, subnet);
    expect(chain.seenSyncCommitteeMessages.get(slot, subnet, validatorIndex)).to.be.equal(
      toHexString(syncCommittee.beaconBlockRoot),
      "should add message root to seenSyncCommitteeMessages"
    );

    // receive same message again
    await expectRejectedWithLodestarError(
      validateGossipSyncCommittee(chain, syncCommittee, subnet),
      SyncCommitteeErrorCode.SYNC_COMMITTEE_MESSAGE_KNOWN
    );
  });

  it("should pass, there is prev root but message root is forkchoice head", async function () {
    const syncCommittee = getSyncCommitteeSignature(currentSlot, validatorIndexInSyncCommittee);
    const headState = generateCachedAltairState({slot: currentSlot}, altairForkEpoch);

    chain.getHeadState.returns(headState);
    chain.bls = new BlsVerifierMock(true);

    const subnet = 3;
    const {slot, validatorIndex} = syncCommittee;
    const prevRoot = "0x1234";
    chain.seenSyncCommitteeMessages.add(slot, subnet, validatorIndex, prevRoot);
    expect(chain.seenSyncCommitteeMessages.get(slot, subnet, validatorIndex)).to.be.equal(
      prevRoot,
      "cache should return prevRoot"
    );
    // but forkchoice head is message root
    forkchoiceStub.getHeadRoot.returns(toHexString(syncCommittee.beaconBlockRoot));
    await validateGossipSyncCommittee(chain, syncCommittee, subnet);
    // should accept the message and overwrite prevRoot
    expect(chain.seenSyncCommitteeMessages.get(slot, subnet, validatorIndex)).to.be.equal(
      toHexString(syncCommittee.beaconBlockRoot),
      "should add message root to seenSyncCommitteeMessages"
    );

    // receive same message again
    await expectRejectedWithLodestarError(
      validateGossipSyncCommittee(chain, syncCommittee, subnet),
      SyncCommitteeErrorCode.SYNC_COMMITTEE_MESSAGE_KNOWN
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
