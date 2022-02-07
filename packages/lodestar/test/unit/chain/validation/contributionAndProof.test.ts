import {initBLS} from "@chainsafe/lodestar-cli/src/util";
import {defaultChainConfig} from "@chainsafe/lodestar-config";
import sinon from "sinon";
import {SinonStubbedInstance} from "sinon";
import {BeaconChain, IBeaconChain} from "../../../../src/chain";
import {LocalClock} from "../../../../src/chain/clock";
import {SyncCommitteeErrorCode} from "../../../../src/chain/errors/syncCommitteeError";
import {expectRejectedWithLodestarError} from "../../../utils/errors";
import {generateSignedContributionAndProof} from "../../../utils/contributionAndProof";
import {validateSyncCommitteeGossipContributionAndProof} from "../../../../src/chain/validation/syncCommitteeContributionAndProof";
// eslint-disable-next-line no-restricted-imports
import * as syncCommitteeUtils from "@chainsafe/lodestar-beacon-state-transition/lib/util/aggregator";
import {SinonStubFn} from "../../../utils/types";
import {generateCachedStateWithPubkeys} from "../../../utils/state";
import {SLOTS_PER_EPOCH} from "@chainsafe/lodestar-params";
import {createIChainForkConfig} from "@chainsafe/lodestar-config";
import {SeenContributionAndProof} from "../../../../src/chain/seenCache";

// https://github.com/ethereum/eth2.0-specs/blob/v1.1.0-alpha.3/specs/altair/p2p-interface.md
describe("Sync Committee Contribution And Proof validation", function () {
  const sandbox = sinon.createSandbox();
  let chain: SinonStubbedInstance<IBeaconChain>;
  let clockStub: SinonStubbedInstance<LocalClock>;
  let isSyncCommitteeAggregatorStub: SinonStubFn<typeof syncCommitteeUtils["isSyncCommitteeAggregator"]>;

  const altairForkEpoch = 2020;
  const currentSlot = SLOTS_PER_EPOCH * (altairForkEpoch + 1);
  // eslint-disable-next-line @typescript-eslint/naming-convention
  const config = createIChainForkConfig(Object.assign({}, defaultChainConfig, {ALTAIR_FORK_EPOCH: altairForkEpoch}));

  before(async function () {
    await initBLS();
  });

  beforeEach(function () {
    chain = sandbox.createStubInstance(BeaconChain);
    (chain as {
      seenContributionAndProof: SeenContributionAndProof;
    }).seenContributionAndProof = new SeenContributionAndProof();
    chain.getGenesisTime.returns(Math.floor(Date.now() / 1000));
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

    const signedContributionAndProof = generateSignedContributionAndProof({contribution: {slot: 1}});
    await expectRejectedWithLodestarError(
      validateSyncCommitteeGossipContributionAndProof(chain, signedContributionAndProof),
      SyncCommitteeErrorCode.NOT_CURRENT_SLOT
    );
  });

  it("should throw error - subcommitteeIndex is not in allowed range", async function () {
    const signedContributionAndProof = generateSignedContributionAndProof({
      contribution: {slot: currentSlot, subcommitteeIndex: 10000},
    });

    await expectRejectedWithLodestarError(
      validateSyncCommitteeGossipContributionAndProof(chain, signedContributionAndProof),
      SyncCommitteeErrorCode.INVALID_SUBCOMMITTEE_INDEX
    );
  });

  it("should throw error - there is same contribution with same aggregator and index and slot", async function () {
    const signedContributionAndProof = generateSignedContributionAndProof({contribution: {slot: currentSlot}});
    const headState = await generateCachedStateWithPubkeys({slot: currentSlot}, config, true);
    chain.getHeadState.returns(headState);
    chain.seenContributionAndProof.isKnown = () => true;
    await expectRejectedWithLodestarError(
      validateSyncCommitteeGossipContributionAndProof(chain, signedContributionAndProof),
      SyncCommitteeErrorCode.SYNC_COMMITTEE_ALREADY_KNOWN
    );
  });

  it("should throw error - no participant", async function () {
    const signedContributionAndProof = generateSignedContributionAndProof({contribution: {slot: currentSlot}});
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
      contribution: {slot: currentSlot, aggregationBits: [true]},
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
  it.skip("should throw error - aggregator index is not in sync committee", async function () {
    const signedContributionAndProof = generateSignedContributionAndProof({contribution: {slot: currentSlot}});
    isSyncCommitteeAggregatorStub.returns(true);
    const headState = await generateCachedStateWithPubkeys({slot: currentSlot}, config, true);
    chain.getHeadState.returns(headState);
    await expectRejectedWithLodestarError(
      validateSyncCommitteeGossipContributionAndProof(chain, signedContributionAndProof),
      SyncCommitteeErrorCode.AGGREGATOR_PUBKEY_UNKNOWN
    );
  });

  it("should throw error - invalid selection_proof signature", async function () {
    const signedContributionAndProof = generateSignedContributionAndProof({
      contribution: {slot: currentSlot, aggregationBits: [true]},
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
