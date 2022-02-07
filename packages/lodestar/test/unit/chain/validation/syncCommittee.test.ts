import {initBLS} from "@chainsafe/lodestar-cli/src/util";
import sinon from "sinon";
import {SinonStubbedInstance} from "sinon";
import {BeaconChain, IBeaconChain} from "../../../../src/chain";
import {LocalClock} from "../../../../src/chain/clock";
import {SyncCommitteeErrorCode} from "../../../../src/chain/errors/syncCommitteeError";
import {validateGossipSyncCommittee} from "../../../../src/chain/validation/syncCommittee";
import {expectRejectedWithLodestarError} from "../../../utils/errors";
import {generateCachedState} from "../../../utils/state";
import {generateSyncCommitteeSignature} from "../../../utils/syncCommittee";
import {Epoch} from "@chainsafe/lodestar-types";
import {SLOTS_PER_EPOCH} from "@chainsafe/lodestar-params";
import {createIChainForkConfig, defaultChainConfig} from "@chainsafe/lodestar-config";
import {SeenSyncCommitteeMessages} from "../../../../src/chain/seenCache";

// https://github.com/ethereum/eth2.0-specs/blob/v1.1.0-alpha.3/specs/altair/p2p-interface.md
describe("Sync Committee Signature validation", function () {
  const sandbox = sinon.createSandbox();
  let chain: SinonStubbedInstance<IBeaconChain>;
  let clockStub: SinonStubbedInstance<LocalClock>;
  // let computeSubnetsForSyncCommitteeStub: SinonStubFn<typeof syncCommitteeUtils["computeSubnetsForSyncCommittee"]>;
  let altairForkEpochBk: Epoch;
  const altairForkEpoch = 2020;
  const currentSlot = SLOTS_PER_EPOCH * (altairForkEpoch + 1);
  // eslint-disable-next-line @typescript-eslint/naming-convention
  const config = createIChainForkConfig(Object.assign({}, defaultChainConfig, {ALTAIR_FORK_EPOCH: altairForkEpoch}));
  // all validators have same pubkey
  const validatorIndexInSyncCommittee = 15;

  before(async function () {
    await initBLS();
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
    chain.getGenesisTime.returns(Math.floor(Date.now() / 1000));
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

    const syncCommittee = generateSyncCommitteeSignature({slot: 1});
    await expectRejectedWithLodestarError(
      validateGossipSyncCommittee(chain, syncCommittee, 0),
      SyncCommitteeErrorCode.NOT_CURRENT_SLOT
    );
  });

  it("should throw error - there has been another valid sync committee signature for the declared slot", async function () {
    const syncCommittee = generateSyncCommitteeSignature({
      slot: currentSlot,
      validatorIndex: validatorIndexInSyncCommittee,
    });
    const headState = generateCachedState({slot: currentSlot}, config, true);
    chain.getHeadState.returns(headState);
    chain.seenSyncCommitteeMessages.isKnown = () => true;
    await expectRejectedWithLodestarError(
      validateGossipSyncCommittee(chain, syncCommittee, 0),
      SyncCommitteeErrorCode.SYNC_COMMITTEE_ALREADY_KNOWN
    );
  });

  it("should throw error - the validator is not part of the current sync committee", async function () {
    const syncCommittee = generateSyncCommitteeSignature({slot: currentSlot, validatorIndex: 100});
    const headState = generateCachedState({slot: currentSlot}, config, true);
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
    const syncCommittee = generateSyncCommitteeSignature({slot: currentSlot, validatorIndex: 1});
    const headState = generateCachedState({slot: currentSlot}, config, true);
    chain.getHeadState.returns(headState);
    await expectRejectedWithLodestarError(
      validateGossipSyncCommittee(chain, syncCommittee, 0),
      SyncCommitteeErrorCode.INVALID_SUBCOMMITTEE_INDEX
    );
  });

  it("should throw error - invalid signature", async function () {
    const syncCommittee = generateSyncCommitteeSignature({
      slot: currentSlot,
      validatorIndex: validatorIndexInSyncCommittee,
    });
    const headState = generateCachedState({slot: currentSlot}, config, true);

    chain.getHeadState.returns(headState);
    chain.bls = {verifySignatureSets: async () => false};
    await expectRejectedWithLodestarError(
      validateGossipSyncCommittee(chain, syncCommittee, 0),
      SyncCommitteeErrorCode.INVALID_SIGNATURE
    );
  });
});
