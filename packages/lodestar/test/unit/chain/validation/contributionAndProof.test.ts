import {defaultChainConfig} from "@chainsafe/lodestar-config";
import sinon from "sinon";
import {SinonStubbedInstance} from "sinon";
import {BitArray} from "@chainsafe/ssz";
import {BeaconChain, IBeaconChain} from "../../../../src/chain/index.js";
import {LocalClock} from "../../../../src/chain/clock/index.js";
import {SyncCommitteeErrorCode} from "../../../../src/chain/errors/syncCommitteeError.js";
import {expectRejectedWithLodestarError} from "../../../utils/errors.js";
import {generateSignedContributionAndProof} from "../../../utils/contributionAndProof.js";
import {validateSyncCommitteeGossipContributionAndProof} from "../../../../src/chain/validation/syncCommitteeContributionAndProof.js";
// eslint-disable-next-line no-restricted-imports
import * as syncCommitteeUtils from "../../../../../beacon-state-transition/src/util/aggregator.js";
import {SinonStubFn} from "../../../utils/types.js";
import {generateCachedStateWithPubkeys} from "../../../utils/state.js";
import {SLOTS_PER_EPOCH, SYNC_COMMITTEE_SUBNET_SIZE} from "@chainsafe/lodestar-params";
import {createIChainForkConfig} from "@chainsafe/lodestar-config";
import {SeenContributionAndProof} from "../../../../src/chain/seenCache/index.js";

// https://github.com/ethereum/consensus-specs/blob/v1.1.10/specs/altair/p2p-interface.md
// TODO remove stub
describe.skip("Sync Committee Contribution And Proof validation", function () {
  const sandbox = sinon.createSandbox();
  let chain: SinonStubbedInstance<IBeaconChain>;
  let clockStub: SinonStubbedInstance<LocalClock>;
  let isSyncCommitteeAggregatorStub: SinonStubFn<typeof syncCommitteeUtils["isSyncCommitteeAggregator"]>;

  const altairForkEpoch = 2020;
  const currentSlot = SLOTS_PER_EPOCH * (altairForkEpoch + 1);
  // eslint-disable-next-line @typescript-eslint/naming-convention
  const config = createIChainForkConfig(Object.assign({}, defaultChainConfig, {ALTAIR_FORK_EPOCH: altairForkEpoch}));
  // all validators have same pubkey
  const aggregatorIndex = 15;

  beforeEach(function () {
    chain = sandbox.createStubInstance(BeaconChain);
    (chain as {
      seenContributionAndProof: SeenContributionAndProof;
    }).seenContributionAndProof = new SeenContributionAndProof(null);
    clockStub = sandbox.createStubInstance(LocalClock);
    chain.clock = clockStub;
    clockStub.isCurrentSlotGivenGossipDisparity.returns(true);
    isSyncCommitteeAggregatorStub = sandbox.stub(syncCommitteeUtils, "isSyncCommitteeAggregator");
  });

  afterEach(function () {
    sandbox.restore();
  });

  it("should throw error - the signature's slot is not the current", async function () {
    clockStub.isCurrentSlotGivenGossipDisparity.returns(false);
    sandbox.stub(clockStub, "currentSlot").get(() => 100);

    const signedContributionAndProof = generateSignedContributionAndProof({contribution: {slot: 1}, aggregatorIndex});
    await expectRejectedWithLodestarError(
      validateSyncCommitteeGossipContributionAndProof(chain, signedContributionAndProof),
      SyncCommitteeErrorCode.NOT_CURRENT_SLOT
    );
  });

  it("should throw error - subcommitteeIndex is not in allowed range", async function () {
    const signedContributionAndProof = generateSignedContributionAndProof({
      contribution: {slot: currentSlot, subcommitteeIndex: 10000},
      aggregatorIndex,
    });

    await expectRejectedWithLodestarError(
      validateSyncCommitteeGossipContributionAndProof(chain, signedContributionAndProof),
      SyncCommitteeErrorCode.INVALID_SUBCOMMITTEE_INDEX
    );
  });

  it("should throw error - same contribution data with superset of aggregationBits already known", async function () {
    const signedContributionAndProof = generateSignedContributionAndProof({
      contribution: {slot: currentSlot},
      aggregatorIndex,
    });
    const headState = await generateCachedStateWithPubkeys({slot: currentSlot}, config, true);
    chain.getHeadState.returns(headState);
    chain.seenContributionAndProof.participantsKnown = () => true;
    await expectRejectedWithLodestarError(
      validateSyncCommitteeGossipContributionAndProof(chain, signedContributionAndProof),
      SyncCommitteeErrorCode.SYNC_COMMITTEE_PARTICIPANTS_ALREADY_KNOWN
    );
  });

  it("should throw error - there is same contribution with same aggregator and index and slot", async function () {
    const signedContributionAndProof = generateSignedContributionAndProof({
      contribution: {slot: currentSlot},
      aggregatorIndex,
    });
    const headState = await generateCachedStateWithPubkeys({slot: currentSlot}, config, true);
    chain.getHeadState.returns(headState);
    chain.seenContributionAndProof.isAggregatorKnown = () => true;
    await expectRejectedWithLodestarError(
      validateSyncCommitteeGossipContributionAndProof(chain, signedContributionAndProof),
      SyncCommitteeErrorCode.SYNC_COMMITTEE_AGGREGATOR_ALREADY_KNOWN
    );
  });

  it("should throw error - no participant", async function () {
    const signedContributionAndProof = generateSignedContributionAndProof({
      contribution: {slot: currentSlot},
      aggregatorIndex,
    });
    const headState = await generateCachedStateWithPubkeys({slot: currentSlot}, config, true);
    chain.getHeadState.returns(headState);
    isSyncCommitteeAggregatorStub.returns(false);
    await expectRejectedWithLodestarError(
      validateSyncCommitteeGossipContributionAndProof(chain, signedContributionAndProof),
      SyncCommitteeErrorCode.NO_PARTICIPANT
    );
  });

  it("should throw error - invalid aggregator", async function () {
    const signedContributionAndProof = generateSignedContributionAndProof({
      contribution: {slot: currentSlot, aggregationBits: BitArray.fromSingleBit(SYNC_COMMITTEE_SUBNET_SIZE, 0)},
      aggregatorIndex,
    });
    const headState = await generateCachedStateWithPubkeys({slot: currentSlot}, config, true);
    chain.getHeadState.returns(headState);
    isSyncCommitteeAggregatorStub.returns(false);
    await expectRejectedWithLodestarError(
      validateSyncCommitteeGossipContributionAndProof(chain, signedContributionAndProof),
      SyncCommitteeErrorCode.INVALID_AGGREGATOR
    );
  });

  /**
   * Skip this spec: [REJECT] The aggregator's validator index is within the current sync committee -- i.e. state.validators[contribution_and_proof.aggregator_index].pubkey in state.current_sync_committee.pubkeys.
   * because we check the aggregator index already and we always sync sync pubkeys with indices
   */
  it("should throw error - aggregator index is not in sync committee", async function () {
    const signedContributionAndProof = generateSignedContributionAndProof({
      contribution: {slot: currentSlot},
      aggregatorIndex: Infinity,
    });
    isSyncCommitteeAggregatorStub.returns(true);
    const headState = await generateCachedStateWithPubkeys({slot: currentSlot}, config, true);
    chain.getHeadState.returns(headState);
    await expectRejectedWithLodestarError(
      validateSyncCommitteeGossipContributionAndProof(chain, signedContributionAndProof),
      SyncCommitteeErrorCode.VALIDATOR_NOT_IN_SYNC_COMMITTEE
    );
  });

  it("should throw error - invalid selection_proof signature", async function () {
    const signedContributionAndProof = generateSignedContributionAndProof({
      contribution: {slot: currentSlot, aggregationBits: BitArray.fromSingleBit(SYNC_COMMITTEE_SUBNET_SIZE, 0)},
      aggregatorIndex,
    });
    isSyncCommitteeAggregatorStub.returns(true);
    const headState = await generateCachedStateWithPubkeys({slot: currentSlot}, config, true);
    chain.getHeadState.returns(headState);
    chain.bls = {verifySignatureSets: async () => false};
    await expectRejectedWithLodestarError(
      validateSyncCommitteeGossipContributionAndProof(chain, signedContributionAndProof),
      SyncCommitteeErrorCode.INVALID_SIGNATURE
    );
  });

  // validation of signed_contribution_and_proof.signature is same test
  // the validation of aggregated signature of aggregation_bits is the same test
});
