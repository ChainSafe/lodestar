import {AbortController} from "@chainsafe/abort-controller";
import {expect} from "chai";
import sinon from "sinon";
import bls from "@chainsafe/bls";
import {toHexString} from "@chainsafe/ssz";
import {createIChainForkConfig} from "@chainsafe/lodestar-config";
import {config as mainnetConfig} from "@chainsafe/lodestar-config/default";
import {SyncCommitteeService} from "../../../src/services/syncCommittee";
import {SyncDutyAndProofs} from "../../../src/services/syncCommitteeDuties";
import {ValidatorStore} from "../../../src/services/validatorStore";
import {getApiClientStub} from "../../utils/apiStub";
import {loggerVc, testLogger} from "../../utils/logger";
import {ClockMock} from "../../utils/clock";
import {IndicesService} from "../../../src/services/indices";
import {ssz} from "@chainsafe/lodestar-types";
import {ChainHeaderTracker} from "../../../src/services/chainHeaderTracker";

/* eslint-disable @typescript-eslint/naming-convention */

describe("SyncCommitteeService", function () {
  const sandbox = sinon.createSandbox();
  const logger = testLogger();
  const ZERO_HASH = Buffer.alloc(32, 0);

  const api = getApiClientStub(sandbox);
  const validatorStore = sinon.createStubInstance(ValidatorStore) as ValidatorStore &
    sinon.SinonStubbedInstance<ValidatorStore>;
  const chainHeaderTracker = sinon.createStubInstance(ChainHeaderTracker) as ChainHeaderTracker &
    sinon.SinonStubbedInstance<ChainHeaderTracker>;
  let pubkeys: Uint8Array[]; // Initialize pubkeys in before() so bls is already initialized

  const config = createIChainForkConfig({
    ...mainnetConfig,
    SECONDS_PER_SLOT: 1 / 1000, // Make slot time super short: 1 ms
    ALTAIR_FORK_EPOCH: 0, // Activate Altair immediatelly
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
    const indicesService = new IndicesService(logger, api, validatorStore);
    const syncCommitteeService = new SyncCommitteeService(
      config,
      loggerVc,
      api,
      clock,
      validatorStore,
      chainHeaderTracker,
      indicesService
    );

    const beaconBlockRoot = Buffer.alloc(32, 0x4d);
    const syncCommitteeSignature = ssz.altair.SyncCommitteeMessage.defaultValue();
    const contribution = ssz.altair.SyncCommitteeContribution.defaultValue();
    const contributionAndProof = ssz.altair.SignedContributionAndProof.defaultValue();
    const duties: SyncDutyAndProofs[] = [
      {
        duty: {
          pubkey: pubkeys[0],
          validatorIndex: 0,
          validatorSyncCommitteeIndices: [7],
        },
        selectionProofs: [{selectionProof: ZERO_HASH, subcommitteeIndex: 0}],
      },
    ];

    // Return empty replies to duties service
    api.beacon.getStateValidators.resolves({data: []});
    api.validator.getSyncCommitteeDuties.resolves({dependentRoot: ZERO_HASH, data: []});

    // Mock duties service to return some duties directly
    syncCommitteeService["dutiesService"].getDutiesAtSlot = sinon.stub().returns(duties);

    // Mock beacon's sync committee and contribution routes

    chainHeaderTracker.getCurrentChainHead.returns(beaconBlockRoot);
    api.beacon.submitPoolSyncCommitteeSignatures.resolves();
    api.validator.produceSyncCommitteeContribution.resolves({data: contribution});
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
