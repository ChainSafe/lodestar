import {AbortController} from "abort-controller";
import {expect} from "chai";
import sinon from "sinon";
import bls from "@chainsafe/bls";
import {createIBeaconConfig} from "@chainsafe/lodestar-config";
import {config as mainnetConfig} from "@chainsafe/lodestar-config/mainnet";
import {SyncCommitteeService} from "../../../src/services/syncCommittee";
import {SyncDutyAndProof} from "../../../src/services/syncCommitteeDuties";
import {ValidatorStore} from "../../../src/services/validatorStore";
import {ApiClientStub} from "../../utils/apiStub";
import {testLogger} from "../../utils/logger";
import {ClockMock} from "../../utils/clock";
import {IndicesService} from "../../../src/services/indices";

/* eslint-disable @typescript-eslint/naming-convention */

describe("SyncCommitteeService", function () {
  const sandbox = sinon.createSandbox();
  const logger = testLogger();
  const ZERO_HASH = Buffer.alloc(32, 0);

  const apiClient = ApiClientStub(sandbox);
  const validatorStore = sinon.createStubInstance(ValidatorStore) as ValidatorStore &
    sinon.SinonStubbedInstance<ValidatorStore>;
  let pubkeys: Uint8Array[]; // Initialize pubkeys in before() so bls is already initialized

  const config = createIBeaconConfig({
    ...mainnetConfig.params,
    SECONDS_PER_SLOT: 1 / 1000, // Make slot time super short: 1 ms
    SLOTS_PER_EPOCH: 3,
    ALTAIR_FORK_EPOCH: 0, // Activate Altair immediatelly
  });

  before(() => {
    const secretKeys = Array.from({length: 1}, (_, i) => bls.SecretKey.fromBytes(Buffer.alloc(32, i + 1)));
    pubkeys = secretKeys.map((sk) => sk.toPublicKey().toBytes());
    validatorStore.votingPubkeys.returns(pubkeys);
    validatorStore.hasVotingPubkey.returns(true);
    validatorStore.hasSomeValidators.returns(true);
    validatorStore.signSelectionProof.resolves(ZERO_HASH);
  });

  let controller: AbortController; // To stop clock
  beforeEach(() => (controller = new AbortController()));
  afterEach(() => controller.abort());

  it("Should produce, sign, and publish a sync committee + contribution", async () => {
    const clock = new ClockMock();
    const indicesService = new IndicesService(logger, apiClient, validatorStore);
    const syncCommitteeService = new SyncCommitteeService(
      config,
      logger,
      apiClient,
      clock,
      validatorStore,
      indicesService
    );

    const beaconBlockRoot = Buffer.alloc(32, 0x4d);
    const syncCommitteeSignature = config.types.altair.SyncCommitteeSignature.defaultValue();
    const contribution = config.types.altair.SyncCommitteeContribution.defaultValue();
    const contributionAndProof = config.types.altair.SignedContributionAndProof.defaultValue();
    const duties: SyncDutyAndProof[] = [
      {
        duty: {
          pubkey: pubkeys[0],
          validatorIndex: 0,
          validatorSyncCommitteeIndices: [7],
        },
        selectionProof: ZERO_HASH,
      },
    ];

    // Return empty replies to duties service
    apiClient.beacon.state.getStateValidators.resolves([]);
    apiClient.validator.getSyncCommitteeDuties.resolves({dependentRoot: ZERO_HASH, data: []});

    // Mock duties service to return some duties directly
    syncCommitteeService["dutiesService"].getDutiesAtSlot = sinon.stub().returns(duties);

    // Mock beacon's sync committee and contribution routes

    apiClient.beacon.blocks.getBlockRoot.resolves(beaconBlockRoot);
    apiClient.beacon.pool.submitSyncCommitteeSignatures.resolves();
    apiClient.validator.produceSyncCommitteeContribution.resolves(contribution);
    apiClient.validator.publishContributionAndProofs.resolves();

    // Mock signing service
    validatorStore.signSyncCommitteeSignature.resolves(syncCommitteeSignature);
    validatorStore.signContributionAndProof.resolves(contributionAndProof);

    // Trigger clock onSlot for slot 0
    await clock.tickSlotFns(0, controller.signal);

    // Must submit the signature received through signSyncCommitteeSignature()
    expect(apiClient.beacon.pool.submitSyncCommitteeSignatures.callCount).to.equal(
      1,
      "submitSyncCommitteeSignatures() must be called once"
    );
    expect(apiClient.beacon.pool.submitSyncCommitteeSignatures.getCall(0).args).to.deep.equal(
      [[syncCommitteeSignature]], // 1 arg, = syncCommitteeSignature[]
      "wrong submitSyncCommitteeSignatures() args"
    );

    // Must submit the aggregate received through produceSyncCommitteeContribution() then signContributionAndProof()
    expect(apiClient.validator.publishContributionAndProofs.callCount).to.equal(
      1,
      "publishContributionAndProofs() must be called once"
    );
    expect(apiClient.validator.publishContributionAndProofs.getCall(0).args).to.deep.equal(
      [[contributionAndProof]], // 1 arg, = contributionAndProof[]
      "wrong publishContributionAndProofs() args"
    );
  });
});
