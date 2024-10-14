import {toHexString} from "@chainsafe/ssz";
import {describe, it, expect, afterEach, beforeEach, beforeAll, afterAll, vi, Mock} from "vitest";
import {altair, Epoch, Slot} from "@lodestar/types";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {createChainForkConfig, defaultChainConfig} from "@lodestar/config";
import {MockedBeaconChain, getMockedBeaconChain} from "../../../mocks/mockedBeaconChain.js";
import {SyncCommitteeErrorCode} from "../../../../src/chain/errors/syncCommitteeError.js";
import {validateGossipSyncCommittee} from "../../../../src/chain/validation/syncCommittee.js";
import {expectRejectedWithLodestarError} from "../../../utils/errors.js";
import {generateCachedAltairState} from "../../../utils/state.js";
import {SeenSyncCommitteeMessages} from "../../../../src/chain/seenCache/index.js";
import {ZERO_HASH} from "../../../../src/constants/constants.js";

// https://github.com/ethereum/consensus-specs/blob/v1.1.10/specs/altair/p2p-interface.md
describe("Sync Committee Signature validation", () => {
  let chain: MockedBeaconChain;
  let clockStub: MockedBeaconChain["clock"];
  let forkchoiceStub: MockedBeaconChain["forkChoice"];
  // let computeSubnetsForSyncCommitteeStub: SinonStubFn<typeof syncCommitteeUtils["computeSubnetsForSyncCommittee"]>;
  let altairForkEpochBk: Epoch;
  const altairForkEpoch = 2020;
  const currentSlot = SLOTS_PER_EPOCH * (altairForkEpoch + 1);
  const config = createChainForkConfig(Object.assign({}, defaultChainConfig, {ALTAIR_FORK_EPOCH: altairForkEpoch}));
  // all validators have same pubkey
  const validatorIndexInSyncCommittee = 15;

  beforeAll(async () => {
    altairForkEpochBk = config.ALTAIR_FORK_EPOCH;
    config.ALTAIR_FORK_EPOCH = altairForkEpoch;
  });

  afterAll(() => {
    config.ALTAIR_FORK_EPOCH = altairForkEpochBk;
  });

  beforeEach(() => {
    chain = getMockedBeaconChain();
    (
      chain as {
        seenSyncCommitteeMessages: SeenSyncCommitteeMessages;
      }
    ).seenSyncCommitteeMessages = new SeenSyncCommitteeMessages();
    clockStub = chain.clock;
    forkchoiceStub = chain.forkChoice;
    vi.spyOn(clockStub, "isCurrentSlotGivenGossipDisparity").mockReturnValue(true);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("should throw error - the signature's slot is in the past", async () => {
    (clockStub.isCurrentSlotGivenGossipDisparity as Mock).mockReturnValue(false);
    vi.spyOn(clockStub, "currentSlot", "get").mockReturnValue(100);

    const syncCommittee = getSyncCommitteeSignature(1, 0);
    await expectRejectedWithLodestarError(
      validateGossipSyncCommittee(chain, syncCommittee, 0),
      SyncCommitteeErrorCode.NOT_CURRENT_SLOT
    );
  });

  it("should throw error - messageRoot is same to prevRoot", async () => {
    const syncCommittee = getSyncCommitteeSignature(currentSlot, validatorIndexInSyncCommittee);
    const headState = generateCachedAltairState({slot: currentSlot}, altairForkEpoch);
    chain.getHeadState.mockReturnValue(headState);
    chain.seenSyncCommitteeMessages.get = () => toHexString(syncCommittee.beaconBlockRoot);
    await expectRejectedWithLodestarError(
      validateGossipSyncCommittee(chain, syncCommittee, 0),
      SyncCommitteeErrorCode.SYNC_COMMITTEE_MESSAGE_KNOWN
    );
  });

  it("should throw error - messageRoot is different to prevRoot but not forkchoice head", async () => {
    const syncCommittee = getSyncCommitteeSignature(currentSlot, validatorIndexInSyncCommittee);
    const headState = generateCachedAltairState({slot: currentSlot}, altairForkEpoch);
    chain.getHeadState.mockReturnValue(headState);
    const prevRoot = "0x1234";
    chain.seenSyncCommitteeMessages.get = () => prevRoot;
    forkchoiceStub.getHeadRoot.mockReturnValue(prevRoot);
    await expectRejectedWithLodestarError(
      validateGossipSyncCommittee(chain, syncCommittee, 0),
      SyncCommitteeErrorCode.SYNC_COMMITTEE_MESSAGE_KNOWN
    );
  });

  it("should throw error - the validator is not part of the current sync committee", async () => {
    const syncCommittee = getSyncCommitteeSignature(currentSlot, 100);
    const headState = generateCachedAltairState({slot: currentSlot}, altairForkEpoch);
    chain.getHeadState.mockReturnValue(headState);

    await expectRejectedWithLodestarError(
      validateGossipSyncCommittee(chain, syncCommittee, 0),
      SyncCommitteeErrorCode.VALIDATOR_NOT_IN_SYNC_COMMITTEE
    );
  });

  /**
   * Skip this spec check: [REJECT] The subnet_id is correct, i.e. subnet_id in compute_subnets_for_sync_committee(state, sync_committee_signature.validator_index)
   * because it's the same to VALIDATOR_NOT_IN_SYNC_COMMITTEE
   */
  it.skip("should throw error - incorrect subnet", async () => {
    const syncCommittee = getSyncCommitteeSignature(currentSlot, 1);
    const headState = generateCachedAltairState({slot: currentSlot}, altairForkEpoch);
    chain.getHeadState.mockReturnValue(headState);
    await expectRejectedWithLodestarError(
      validateGossipSyncCommittee(chain, syncCommittee, 0),
      SyncCommitteeErrorCode.INVALID_SUBCOMMITTEE_INDEX
    );
  });

  it("should throw error - invalid signature", async () => {
    const syncCommittee = getSyncCommitteeSignature(currentSlot, validatorIndexInSyncCommittee);
    const headState = generateCachedAltairState({slot: currentSlot}, altairForkEpoch);

    chain.getHeadState.mockReturnValue(headState);
    chain.bls.verifySignatureSets.mockReturnValue(false);
    await expectRejectedWithLodestarError(
      validateGossipSyncCommittee(chain, syncCommittee, 0),
      SyncCommitteeErrorCode.INVALID_SIGNATURE
    );
  });

  it("should pass, no prev root", async () => {
    const syncCommittee = getSyncCommitteeSignature(currentSlot, validatorIndexInSyncCommittee);
    const subnet = 3;
    const {slot, validatorIndex} = syncCommittee;
    const headState = generateCachedAltairState({slot: currentSlot}, altairForkEpoch);

    chain.getHeadState.mockReturnValue(headState);
    // "should be null"
    expect(chain.seenSyncCommitteeMessages.get(slot, subnet, validatorIndex)).toBeNull();
    await validateGossipSyncCommittee(chain, syncCommittee, subnet);
    expect(chain.seenSyncCommitteeMessages.get(slot, subnet, validatorIndex)).toBe(
      toHexString(syncCommittee.beaconBlockRoot)
    );

    // receive same message again
    await expectRejectedWithLodestarError(
      validateGossipSyncCommittee(chain, syncCommittee, subnet),
      SyncCommitteeErrorCode.SYNC_COMMITTEE_MESSAGE_KNOWN
    );
  });

  it("should pass, there is prev root but message root is forkchoice head", async () => {
    const syncCommittee = getSyncCommitteeSignature(currentSlot, validatorIndexInSyncCommittee);
    const headState = generateCachedAltairState({slot: currentSlot}, altairForkEpoch);

    chain.getHeadState.mockReturnValue(headState);

    const subnet = 3;
    const {slot, validatorIndex} = syncCommittee;
    const prevRoot = "0x1234";
    chain.seenSyncCommitteeMessages.add(slot, subnet, validatorIndex, prevRoot);
    expect(chain.seenSyncCommitteeMessages.get(slot, subnet, validatorIndex)).toBe(prevRoot);
    // but forkchoice head is message root
    forkchoiceStub.getHeadRoot.mockReturnValue(toHexString(syncCommittee.beaconBlockRoot));
    await validateGossipSyncCommittee(chain, syncCommittee, subnet);
    // should accept the message and overwrite prevRoot
    expect(chain.seenSyncCommitteeMessages.get(slot, subnet, validatorIndex)).toBe(
      toHexString(syncCommittee.beaconBlockRoot)
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
