import {initBLS} from "@chainsafe/lodestar-cli/src/util";
import {config} from "@chainsafe/lodestar-config/minimal";
import {ForkChoice, IForkChoice} from "@chainsafe/lodestar-fork-choice";
import sinon from "sinon";
import {SinonStubbedInstance} from "sinon";
import {BeaconChain, IBeaconChain} from "../../../../src/chain";
import {LocalClock} from "../../../../src/chain/clock";
import {SyncCommitteeErrorCode} from "../../../../src/chain/errors/syncCommitteeError";
import {validateGossipSyncCommittee} from "../../../../src/chain/validation/syncCommittee";
import {expectRejectedWithLodestarError} from "../../../utils/errors";
import {generateCachedState} from "../../../utils/state";
import {StubbedBeaconDb} from "../../../utils/stub";
import {generateSyncCommitteeSignature} from "../../../utils/syncCommittee";
import * as syncCommitteeUtils from "@chainsafe/lodestar-beacon-state-transition/lib/util/syncCommittee";
import {SinonStubFn} from "../../../utils/types";

// https://github.com/ethereum/eth2.0-specs/blob/v1.1.0-alpha.3/specs/altair/p2p-interface.md
describe("Sync Committee Signature validation", function () {
  const sandbox = sinon.createSandbox();
  let chain: SinonStubbedInstance<IBeaconChain>;
  let forkChoiceStub: SinonStubbedInstance<IForkChoice>;
  let computeSubnetsForSyncCommitteeStub: SinonStubFn<typeof syncCommitteeUtils["computeSubnetsForSyncCommittee"]>;
  let db: StubbedBeaconDb;

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
    computeSubnetsForSyncCommitteeStub = sandbox.stub(syncCommitteeUtils, "computeSubnetsForSyncCommittee");
  });

  afterEach(function () {
    sandbox.restore();
  });

  it("should throw error - the signature's slot is in the past", async function () {
    const syncCommittee = generateSyncCommitteeSignature({slot: 1});
    await expectRejectedWithLodestarError(
      validateGossipSyncCommittee(config, chain, db, {syncCommittee, validSignature: false}, 0),
      SyncCommitteeErrorCode.PAST_SLOT
    );
  });

  it("should throw error - the signature's slot is in the future", async function () {
    const syncCommittee = generateSyncCommitteeSignature({slot: 3});
    await expectRejectedWithLodestarError(
      validateGossipSyncCommittee(config, chain, db, {syncCommittee, validSignature: false}, 0),
      SyncCommitteeErrorCode.FUTURE_SLOT
    );
  });

  it("should throw error - the block being signed over has not been seen", async function () {
    const syncCommittee = generateSyncCommitteeSignature({slot: 2});
    forkChoiceStub.hasBlock.returns(false);
    await expectRejectedWithLodestarError(
      validateGossipSyncCommittee(config, chain, db, {syncCommittee, validSignature: false}, 0),
      SyncCommitteeErrorCode.UNKNOWN_BEACON_BLOCK_ROOT
    );
  });

  it("should throw error - there has been another valid sync committee signature for the declared slot", async function () {
    const syncCommittee = generateSyncCommitteeSignature({slot: 2});
    forkChoiceStub.hasBlock.returns(true);
    db.seenSyncCommiteeCache.hasSyncCommitteeSignature.returns(true);
    await expectRejectedWithLodestarError(
      validateGossipSyncCommittee(config, chain, db, {syncCommittee, validSignature: false}, 0),
      SyncCommitteeErrorCode.SYNC_COMMITTEE_ALREADY_KNOWN
    );
  });

  it("should throw error - the validator is not part of the current sync committee", async function () {
    const syncCommittee = generateSyncCommitteeSignature({slot: 2, validatorIndex: 1});
    forkChoiceStub.hasBlock.returns(true);
    db.seenSyncCommiteeCache.hasSyncCommitteeSignature.returns(false);
    const state = generateCachedState({}, config, true);
    // all validators have same pubkey, make validator 0 different
    state.validators[0].pubkey = Buffer.alloc(48, 1);
    const pubkey0 = state.validators[0].pubkey;
    // syncCommittee has validator 0 but not 1
    const headState = generateCachedState(
      {
        currentSyncCommittee: {
          pubkeys: Array.from({length: config.params.SYNC_COMMITTEE_SIZE}, () => pubkey0),
          pubkeyAggregates: [Buffer.alloc(48, 0)],
        },
      },
      config,
      true
    );
    chain.getHeadState.returns(headState);

    await expectRejectedWithLodestarError(
      validateGossipSyncCommittee(config, chain, db, {syncCommittee, validSignature: false}, 0),
      SyncCommitteeErrorCode.VALIDATOR_NOT_IN_SYNC_COMMITTEE
    );
  });

  it("should throw error - incorrect subnet", async function () {
    computeSubnetsForSyncCommitteeStub.returns([10]);
    const syncCommittee = generateSyncCommitteeSignature({slot: 2, validatorIndex: 1});
    forkChoiceStub.hasBlock.returns(true);
    db.seenSyncCommiteeCache.hasSyncCommitteeSignature.returns(false);
    const commonPubkey = generateCachedState().validators[0].pubkey;
    const headState = generateCachedState(
      {
        currentSyncCommittee: {
          pubkeys: Array.from({length: config.params.SYNC_COMMITTEE_SIZE}, () => commonPubkey),
          pubkeyAggregates: [Buffer.alloc(48, 0)],
        },
      },
      config,
      true
    );
    chain.getHeadState.returns(headState);
    await expectRejectedWithLodestarError(
      validateGossipSyncCommittee(config, chain, db, {syncCommittee, validSignature: false}, 0),
      SyncCommitteeErrorCode.INVALID_SUBNET_ID
    );
  });

  it("should throw error - invalid signature", async function () {
    computeSubnetsForSyncCommitteeStub.returns([0]);
    const syncCommittee = generateSyncCommitteeSignature({slot: 2, validatorIndex: 1});
    forkChoiceStub.hasBlock.returns(true);
    db.seenSyncCommiteeCache.hasSyncCommitteeSignature.returns(false);
    const commonPubkey = generateCachedState().validators[0].pubkey;
    const headState = generateCachedState(
      {
        currentSyncCommittee: {
          pubkeys: Array.from({length: config.params.SYNC_COMMITTEE_SIZE}, () => commonPubkey),
          pubkeyAggregates: [Buffer.alloc(48, 0)],
        },
      },
      config,
      true
    );
    chain.getHeadState.returns(headState);
    chain.bls = {verifySignatureSets: async () => false};
    await expectRejectedWithLodestarError(
      validateGossipSyncCommittee(config, chain, db, {syncCommittee, validSignature: false}, 0),
      SyncCommitteeErrorCode.INVALID_SIGNATURE
    );
  });
});
