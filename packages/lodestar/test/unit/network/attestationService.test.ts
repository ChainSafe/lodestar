import {allForks, ATTESTATION_SUBNET_COUNT, phase0} from "@chainsafe/lodestar-types";
import {ForkName} from "@chainsafe/lodestar-config";
import {getCurrentSlot} from "@chainsafe/lodestar-beacon-state-transition";
import * as stateTransitionUtils from "@chainsafe/lodestar-beacon-state-transition/lib/util/attestation";
import * as mathUtils from "@chainsafe/lodestar-utils/lib/math";
import {config} from "@chainsafe/lodestar-config/minimal";
import sinon, {SinonStubbedInstance} from "sinon";
import {MockBeaconChain} from "../../utils/mocks/chain/chain";
import {generateState} from "../../utils/state";
import {TreeBacked} from "@chainsafe/ssz";
import {testLogger} from "../../utils/logger";
import {expect} from "chai";
import {SinonStubFn} from "../../utils/types";
import {MetadataController} from "../../../src/network/metadata";
import {Eth2Gossipsub} from "../../../src/network/gossip";
import {AttestationService} from "../../../src/network/attestationService";
import {ChainEvent, IBeaconChain} from "../../../src/chain";

describe("AttestationService", function () {
  let service: AttestationService;

  const sandbox = sinon.createSandbox();
  // let clock: SinonFakeTimers;
  let gossipStub: SinonStubbedInstance<Eth2Gossipsub>;
  let computeSubnetUtil: SinonStubFn<typeof stateTransitionUtils["computeSubnetForCommitteesAtSlot"]>;
  let randomUtil: SinonStubFn<typeof mathUtils["randBetween"]>;
  let metadata: MetadataController;

  let chain: IBeaconChain;
  const logger = testLogger();
  let state: allForks.BeaconState;
  let subscription: phase0.BeaconCommitteeSubscription;
  const {SLOTS_PER_EPOCH, SECONDS_PER_SLOT, EPOCHS_PER_RANDOM_SUBNET_SUBSCRIPTION} = config.params;
  const COMMITTEE_SUBNET_SUBSCRIPTION = 10;

  beforeEach(function () {
    sandbox.useFakeTimers(Date.now());
    gossipStub = sandbox.createStubInstance(Eth2Gossipsub);
    computeSubnetUtil = sandbox.stub(stateTransitionUtils, "computeSubnetForCommitteesAtSlot");
    computeSubnetUtil.returns(COMMITTEE_SUBNET_SUBSCRIPTION);
    randomUtil = sandbox.stub(mathUtils, "randBetween");
    randomUtil
      .withArgs(EPOCHS_PER_RANDOM_SUBNET_SUBSCRIPTION, 2 * EPOCHS_PER_RANDOM_SUBNET_SUBSCRIPTION)
      .returns(EPOCHS_PER_RANDOM_SUBNET_SUBSCRIPTION + 1);
    randomUtil.withArgs(0, ATTESTATION_SUBNET_COUNT).returns(30);
    randomUtil.withArgs(0, ATTESTATION_SUBNET_COUNT - 1).returns(40);
    state = generateState();
    chain = new MockBeaconChain({
      genesisTime: Math.floor(Date.now() / 1000),
      chainId: 0,
      networkId: BigInt(0),
      state: state as TreeBacked<allForks.BeaconState>,
      config,
    });
    // load getCurrentSlot first, vscode not able to debug without this
    getCurrentSlot(config, Math.floor(Date.now() / 1000));
    metadata = new MetadataController({}, {config, chain, logger});
    service = new AttestationService({
      config,
      chain,
      logger,
      gossip: (gossipStub as unknown) as Eth2Gossipsub,
      metadata,
    });
    service.start();
    subscription = {
      validatorIndex: 2021,
      committeeIndex: 2,
      committeesAtSlot: 10,
      slot: 100,
      isAggregator: false,
    };
  });

  afterEach(() => {
    service.stop();
    sandbox.restore();
  });

  it("should not subscribe when there is no active validator", () => {
    chain.emitter.emit(ChainEvent.clockSlot, 1);
    expect(gossipStub.subscribeTopic.called).to.be.false;
  });

  it("should subscribe to RANDOM_SUBNETS_PER_VALIDATOR per 1 validator", () => {
    randomUtil.withArgs(0, ATTESTATION_SUBNET_COUNT).returns(30);
    randomUtil.withArgs(0, ATTESTATION_SUBNET_COUNT - 1).returns(40);
    service.addBeaconCommitteeSubscriptions([subscription]);
    expect(gossipStub.subscribeTopic.calledOnce).to.be.true;
    expect(metadata.seqNumber).to.be.equal(BigInt(1));
    // subscribe with a different validator
    subscription.validatorIndex = 2022;
    service.addBeaconCommitteeSubscriptions([subscription]);
    expect(gossipStub.subscribeTopic.calledTwice).to.be.true;
    expect(metadata.seqNumber).to.be.equal(BigInt(2));
    // subscribe with same validator
    subscription.validatorIndex = 2021;
    service.addBeaconCommitteeSubscriptions([subscription]);
    expect(gossipStub.subscribeTopic.calledTwice).to.be.true;
    expect(metadata.seqNumber).to.be.equal(BigInt(2));
  });

  it("should handle validator expiry", async () => {
    service.addBeaconCommitteeSubscriptions([subscription]);
    expect(metadata.seqNumber).to.be.equal(BigInt(1));
    expect(EPOCHS_PER_RANDOM_SUBNET_SUBSCRIPTION * SLOTS_PER_EPOCH).to.be.gt(150);
    sandbox.clock.tick(150 * SLOTS_PER_EPOCH * SECONDS_PER_SLOT * 1000);
    expect(gossipStub.unsubscribeTopic.called).to.be.true;
    // subscribe then unsubscribe
    expect(metadata.seqNumber).to.be.equal(BigInt(2));
  });

  it("should change subnet subscription after 2*EPOCHS_PER_RANDOM_SUBNET_SUBSCRIPTION", async () => {
    service.addBeaconCommitteeSubscriptions([subscription]);
    expect(gossipStub.subscribeTopic.calledOnce).to.be.true;
    expect(metadata.seqNumber).to.be.equal(BigInt(1));
    for (let numEpoch = 0; numEpoch < 2 * EPOCHS_PER_RANDOM_SUBNET_SUBSCRIPTION; numEpoch++) {
      // avoid known validator expiry
      service.addBeaconCommitteeSubscriptions([subscription]);
      sandbox.clock.tick(SLOTS_PER_EPOCH * SECONDS_PER_SLOT * 1000);
    }
    // may call 2 times, 1 for committee subnet, 1 for random subnet
    expect(gossipStub.unsubscribeTopic.called).to.be.true;
    // subscribe then unsubscribe then subscribe again
    expect(metadata.seqNumber).to.be.equal(BigInt(3));
  });

  it("should prepare for a hard fork", async () => {
    const BK_ALTAIR_FORK_EPOCH = config.forks.altair.epoch;
    const altairEpoch = 3 * EPOCHS_PER_RANDOM_SUBNET_SUBSCRIPTION;
    config.forks.altair.epoch = altairEpoch;
    expect(config.forks.altair.epoch).to.be.equal(altairEpoch);
    service.stop();
    service = new AttestationService({
      config,
      chain,
      logger,
      gossip: (gossipStub as unknown) as Eth2Gossipsub,
      metadata,
    });
    service.start();
    service.addBeaconCommitteeSubscriptions([subscription]);
    // run per 4 * 32 slots (or any num slots < 150)
    while (chain.clock.currentSlot < (altairEpoch - EPOCHS_PER_RANDOM_SUBNET_SUBSCRIPTION) * SLOTS_PER_EPOCH) {
      // avoid known validator expiry
      service.addBeaconCommitteeSubscriptions([subscription]);
      sandbox.clock.tick(4 * SLOTS_PER_EPOCH * SECONDS_PER_SLOT * 1000);
    }
    // 1 known validator
    expect(getNextForkRandomSubnets(service).length).to.be.equal(1);
    const randomSubnet = getNextForkRandomSubnets(service)[0];
    while (chain.clock.currentSlot * SLOTS_PER_EPOCH < altairEpoch) {
      service.addBeaconCommitteeSubscriptions([subscription]);
      sandbox.clock.tick(4 * SLOTS_PER_EPOCH * SECONDS_PER_SLOT * 1000);
    }
    // TODO: passed altair, but chain always return "phase0" now
    sandbox.stub(chain, "getHeadForkName").returns(ForkName.altair);
    sandbox.clock.tick(SECONDS_PER_SLOT * 1000);
    // transition to altair
    expect(getNextForkRandomSubnets(service)).to.be.deep.equal([]);
    expect(service.getActiveSubnets().includes(randomSubnet)).to.be.true;
    config.forks.altair.epoch = BK_ALTAIR_FORK_EPOCH;
  });

  it("handle committee subnet the same to random subnet", () => {
    randomUtil.withArgs(0, ATTESTATION_SUBNET_COUNT).returns(COMMITTEE_SUBNET_SUBSCRIPTION);
    const aggregatorSubscription: phase0.BeaconCommitteeSubscription = {...subscription, isAggregator: true};
    service.addBeaconCommitteeSubscriptions([aggregatorSubscription]);
    expect(service.getActiveSubnets()).to.be.deep.equal([COMMITTEE_SUBNET_SUBSCRIPTION]);
    // committee subnet is same to random subnet
    expect(gossipStub.subscribeTopic.calledOnce).to.be.true;
    expect(metadata.seqNumber).to.be.equal(BigInt(1));
    // pass through subscription slot
    sandbox.clock.tick((aggregatorSubscription.slot + 2) * SECONDS_PER_SLOT * 1000);
    // don't unsubscribe bc random subnet is still there
    expect(gossipStub.unsubscribeTopic.called).to.be.false;
  });
});

function getNextForkRandomSubnets(service: AttestationService): number[] {
  const nextForkRandomSubnets = service["nextForkRandomSubnets"];
  if (nextForkRandomSubnets) {
    return nextForkRandomSubnets.getActive(service["chain"].clock.currentSlot);
  }
  return [];
}
