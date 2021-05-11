import {initBLS} from "@chainsafe/lodestar-cli/src/util";
import {config} from "@chainsafe/lodestar-config/minimal";
import {ForkChoice, IForkChoice} from "@chainsafe/lodestar-fork-choice";
import sinon from "sinon";
import {SinonStubbedInstance} from "sinon";
import {BeaconChain, IBeaconChain} from "../../../../src/chain";
import {LocalClock} from "../../../../src/chain/clock";
import {SyncCommitteeErrorCode} from "../../../../src/chain/errors/syncCommitteeError";
import {expectRejectedWithLodestarError} from "../../../utils/errors";
import {StubbedBeaconDb} from "../../../utils/stub";
import {generateSignedContributionAndProof} from "../../../utils/contributionAndProof";
import {validateSyncCommitteeGossipContributionAndProof} from "../../../../src/chain/validation/syncCommitteeContributionAndProof";
import * as syncCommitteeUtils from "@chainsafe/lodestar-beacon-state-transition/lib/util/syncCommittee";
import {SinonStubFn} from "../../../utils/types";
import {generateCachedState} from "../../../utils/state";

// https://github.com/ethereum/eth2.0-specs/blob/v1.1.0-alpha.3/specs/altair/p2p-interface.md
describe("Sync Committee Contribution And Proof validation", function () {
  const sandbox = sinon.createSandbox();
  let chain: SinonStubbedInstance<IBeaconChain>;
  let forkChoiceStub: SinonStubbedInstance<IForkChoice>;
  let db: StubbedBeaconDb;
  let isSyncCommitteeAggregatorStub: SinonStubFn<typeof syncCommitteeUtils["isSyncCommitteeAggregator"]>;
  let getSyncSubCommitteePubkeysStub: SinonStubFn<typeof syncCommitteeUtils["getSyncSubCommitteePubkeys"]>;

  // TODO: remove
  before(async function () {
    await initBLS();
  });

  beforeEach(function () {
    chain = sandbox.createStubInstance(BeaconChain);
    chain.getGenesisTime.returns(Math.floor(Date.now() / 1000));
    chain.clock = sandbox.createStubInstance(LocalClock);
    sandbox.stub(chain.clock, "currentSlot").get(() => 2);
    forkChoiceStub = sandbox.createStubInstance(ForkChoice);
    chain.forkChoice = forkChoiceStub;
    db = new StubbedBeaconDb(sandbox, config);
    isSyncCommitteeAggregatorStub = sandbox.stub(syncCommitteeUtils, "isSyncCommitteeAggregator");
    getSyncSubCommitteePubkeysStub = sandbox.stub(syncCommitteeUtils, "getSyncSubCommitteePubkeys");
  });

  afterEach(function () {
    sandbox.restore();
  });

  it("should throw error - the signature's slot is in the past", async function () {
    const signedContributionAndProof = generateSignedContributionAndProof({contribution: {slot: 1}});
    await expectRejectedWithLodestarError(
      validateSyncCommitteeGossipContributionAndProof(config, chain, db, {
        contributionAndProof: signedContributionAndProof,
        validSignature: false,
      }),
      SyncCommitteeErrorCode.PAST_SLOT
    );
  });

  it("should throw error - the signature's slot is in the future", async function () {
    const signedContributionAndProof = generateSignedContributionAndProof({contribution: {slot: 3}});
    await expectRejectedWithLodestarError(
      validateSyncCommitteeGossipContributionAndProof(config, chain, db, {
        contributionAndProof: signedContributionAndProof,
        validSignature: false,
      }),
      SyncCommitteeErrorCode.FUTURE_SLOT
    );
  });

  it("should throw error - the block being signed over has not been seen", async function () {
    const signedContributionAndProof = generateSignedContributionAndProof({contribution: {slot: 2}});
    forkChoiceStub.hasBlock.returns(false);

    await expectRejectedWithLodestarError(
      validateSyncCommitteeGossipContributionAndProof(config, chain, db, {
        contributionAndProof: signedContributionAndProof,
        validSignature: false,
      }),
      SyncCommitteeErrorCode.UNKNOWN_BEACON_BLOCK_ROOT
    );
  });

  it("should throw error - subCommitteeIndex is not in allowed range", async function () {
    const signedContributionAndProof = generateSignedContributionAndProof({
      contribution: {slot: 2, subCommitteeIndex: 10000},
    });
    forkChoiceStub.hasBlock.returns(true);

    await expectRejectedWithLodestarError(
      validateSyncCommitteeGossipContributionAndProof(config, chain, db, {
        contributionAndProof: signedContributionAndProof,
        validSignature: false,
      }),
      SyncCommitteeErrorCode.INVALID_SUB_COMMITTEE_INDEX
    );
  });

  it("should throw error - there is same contribution with same aggregator and index and slot", async function () {
    const signedContributionAndProof = generateSignedContributionAndProof({contribution: {slot: 2}});
    forkChoiceStub.hasBlock.returns(true);
    db.seenSyncCommitteeContributionCache.hasContributionAndProof.returns(true);
    await expectRejectedWithLodestarError(
      validateSyncCommitteeGossipContributionAndProof(config, chain, db, {
        contributionAndProof: signedContributionAndProof,
        validSignature: false,
      }),
      SyncCommitteeErrorCode.SYNC_COMMITTEE_ALREADY_KNOWN
    );
  });

  it("should throw error - invalid aggregator", async function () {
    const signedContributionAndProof = generateSignedContributionAndProof({contribution: {slot: 2}});
    forkChoiceStub.hasBlock.returns(true);
    db.seenSyncCommitteeContributionCache.hasContributionAndProof.returns(false);
    isSyncCommitteeAggregatorStub.returns(false);
    await expectRejectedWithLodestarError(
      validateSyncCommitteeGossipContributionAndProof(config, chain, db, {
        contributionAndProof: signedContributionAndProof,
        validSignature: false,
      }),
      SyncCommitteeErrorCode.INVALID_AGGREGATOR
    );
  });

  it("should throw error - aggregator index is not in sync committee", async function () {
    const signedContributionAndProof = generateSignedContributionAndProof({contribution: {slot: 2}});
    forkChoiceStub.hasBlock.returns(true);
    db.seenSyncCommitteeContributionCache.hasContributionAndProof.returns(false);
    isSyncCommitteeAggregatorStub.returns(true);
    const headState = generateCachedState({}, config, true);
    chain.getHeadState.returns(headState);
    getSyncSubCommitteePubkeysStub.returns([]);
    await expectRejectedWithLodestarError(
      validateSyncCommitteeGossipContributionAndProof(config, chain, db, {
        contributionAndProof: signedContributionAndProof,
        validSignature: false,
      }),
      SyncCommitteeErrorCode.AGGREGATOR_PUBKEY_UNKNOWN
    );
  });

  it("should throw error - invalid selection_proof signature", async function () {
    const signedContributionAndProof = generateSignedContributionAndProof({contribution: {slot: 2}});
    forkChoiceStub.hasBlock.returns(true);
    db.seenSyncCommitteeContributionCache.hasContributionAndProof.returns(false);
    isSyncCommitteeAggregatorStub.returns(true);
    const headState = generateCachedState({}, config, true);
    chain.getHeadState.returns(headState);
    getSyncSubCommitteePubkeysStub.returns([headState.validators[0].pubkey]);
    chain.bls = {verifySignatureSets: async () => false};
    await expectRejectedWithLodestarError(
      validateSyncCommitteeGossipContributionAndProof(config, chain, db, {
        contributionAndProof: signedContributionAndProof,
        validSignature: false,
      }),
      SyncCommitteeErrorCode.INVALID_SIGNATURE
    );
  });

  // validation of signed_contribution_and_proof.signature is same test
  // the validation of aggregated signature of aggregation_bits is the same test
});
