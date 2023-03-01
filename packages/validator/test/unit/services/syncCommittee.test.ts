import {expect} from "chai";
import sinon from "sinon";
import bls from "@chainsafe/bls";
import {toHexString} from "@chainsafe/ssz";
import {createChainForkConfig} from "@lodestar/config";
import {config as mainnetConfig} from "@lodestar/config/default";
import {ssz} from "@lodestar/types";
import {HttpStatusCode} from "@lodestar/api";
import {SyncCommitteeService} from "../../../src/services/syncCommittee.js";
import {SyncDutyAndProofs} from "../../../src/services/syncCommitteeDuties.js";
import {ValidatorStore} from "../../../src/services/validatorStore.js";
import {getApiClientStub} from "../../utils/apiStub.js";
import {loggerVc} from "../../utils/logger.js";
import {ClockMock} from "../../utils/clock.js";
import {ChainHeaderTracker} from "../../../src/services/chainHeaderTracker.js";
import {ZERO_HASH} from "../../utils/types.js";
import {ValidatorEventEmitter} from "../../../src/services/emitter.js";

/* eslint-disable @typescript-eslint/naming-convention */

describe("SyncCommitteeService", function () {
  const sandbox = sinon.createSandbox();

  const api = getApiClientStub(sandbox);
  const validatorStore = sinon.createStubInstance(ValidatorStore) as ValidatorStore &
    sinon.SinonStubbedInstance<ValidatorStore>;
  const emitter = sinon.createStubInstance(ValidatorEventEmitter) as ValidatorEventEmitter &
    sinon.SinonStubbedInstance<ValidatorEventEmitter>;
  const chainHeaderTracker = sinon.createStubInstance(ChainHeaderTracker) as ChainHeaderTracker &
    sinon.SinonStubbedInstance<ChainHeaderTracker>;
  let pubkeys: Uint8Array[]; // Initialize pubkeys in before() so bls is already initialized

  const config = createChainForkConfig({
    ...mainnetConfig,
    SECONDS_PER_SLOT: 1 / 1000, // Make slot time super short: 1 ms
    ALTAIR_FORK_EPOCH: 0, // Activate Altair immediately
  });

  before(() => {
    const secretKeys = Array.from({length: 1}, (_, i) => bls.SecretKey.fromBytes(Buffer.alloc(32, i + 1)));
    pubkeys = secretKeys.map((sk) => sk.toPublicKey().toBytes());
    validatorStore.votingPubkeys.returns(pubkeys.map(toHexString));
    validatorStore.hasVotingPubkey.returns(true);
    validatorStore.hasSomeValidators.returns(true);
    validatorStore.signAttestationSelectionProof.resolves(ZERO_HASH);
  });

  let controller: AbortController; // To stop clock
  beforeEach(() => (controller = new AbortController()));
  afterEach(() => controller.abort());

  it("Should produce, sign, and publish a sync committee + contribution", async () => {
    const clock = new ClockMock();
    const syncCommitteeService = new SyncCommitteeService(
      config,
      loggerVc,
      api,
      clock,
      validatorStore,
      emitter,
      chainHeaderTracker,
      null
    );

    const beaconBlockRoot = Buffer.alloc(32, 0x4d);
    const syncCommitteeSignature = ssz.altair.SyncCommitteeMessage.defaultValue();
    const contribution = ssz.altair.SyncCommitteeContribution.defaultValue();
    const contributionAndProof = ssz.altair.SignedContributionAndProof.defaultValue();
    const duties: SyncDutyAndProofs[] = [
      {
        duty: {
          pubkey: toHexString(pubkeys[0]),
          validatorIndex: 0,
          subnets: [0],
        },
        selectionProofs: [{selectionProof: ZERO_HASH, subcommitteeIndex: 0}],
      },
    ];

    // Return empty replies to duties service
    api.beacon.getStateValidators.resolves({
      response: {data: [], executionOptimistic: false},
      ok: true,
      status: HttpStatusCode.OK,
    });
    api.validator.getSyncCommitteeDuties.resolves({
      response: {data: [], executionOptimistic: false},
      ok: true,
      status: HttpStatusCode.OK,
    });

    // Mock duties service to return some duties directly
    syncCommitteeService["dutiesService"].getDutiesAtSlot = sinon.stub().returns(duties);

    // Mock beacon's sync committee and contribution routes

    chainHeaderTracker.getCurrentChainHead.returns(beaconBlockRoot);
    api.beacon.submitPoolSyncCommitteeSignatures.resolves();
    api.validator.produceSyncCommitteeContribution.resolves({
      response: {data: contribution},
      ok: true,
      status: HttpStatusCode.OK,
    });
    api.validator.publishContributionAndProofs.resolves();

    // Mock signing service
    validatorStore.signSyncCommitteeSignature.resolves(syncCommitteeSignature);
    validatorStore.signContributionAndProof.resolves(contributionAndProof);

    // Trigger clock onSlot for slot 0
    await clock.tickSlotFns(0, controller.signal);

    // Must submit the signature received through signSyncCommitteeSignature()
    expect(api.beacon.submitPoolSyncCommitteeSignatures.callCount).to.equal(
      1,
      "submitPoolSyncCommitteeSignatures() must be called once"
    );
    expect(api.beacon.submitPoolSyncCommitteeSignatures.getCall(0).args).to.deep.equal(
      [[syncCommitteeSignature]], // 1 arg, = syncCommitteeSignature[]
      "wrong submitPoolSyncCommitteeSignatures() args"
    );

    // Must submit the aggregate received through produceSyncCommitteeContribution() then signContributionAndProof()
    expect(api.validator.publishContributionAndProofs.callCount).to.equal(
      1,
      "publishContributionAndProofs() must be called once"
    );
    expect(api.validator.publishContributionAndProofs.getCall(0).args).to.deep.equal(
      [[contributionAndProof]], // 1 arg, = contributionAndProof[]
      "wrong publishContributionAndProofs() args"
    );
  });
});
