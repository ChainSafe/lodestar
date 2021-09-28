import {allForks} from "@chainsafe/lodestar-types";
import {
  ATTESTATION_SUBNET_COUNT,
  EPOCHS_PER_RANDOM_SUBNET_SUBSCRIPTION,
  ForkName,
  SLOTS_PER_EPOCH,
} from "@chainsafe/lodestar-params";
import {createIBeaconConfig} from "@chainsafe/lodestar-config";
import {getCurrentSlot} from "@chainsafe/lodestar-beacon-state-transition";
// eslint-disable-next-line no-restricted-imports
import * as mathUtils from "@chainsafe/lodestar-utils/lib/math";
import * as shuffleUtils from "../../../src/util/shuffle";
import sinon, {SinonStubbedInstance} from "sinon";
import {MockBeaconChain} from "../../utils/mocks/chain/chain";
import {generateState} from "../../utils/state";
import {TreeBacked} from "@chainsafe/ssz";
import {testLogger} from "../../utils/logger";
import {expect} from "chai";
import {SinonStubFn} from "../../utils/types";
import {MetadataController} from "../../../src/network/metadata";
import {Eth2Gossipsub, GossipType} from "../../../src/network/gossip";
import {AttnetsService, CommitteeSubscription} from "../../../src/network/subnets";
import {ChainEvent, IBeaconChain} from "../../../src/chain";
import {ZERO_HASH} from "../../../src/constants";

describe("AttnetsService", function () {
  const COMMITTEE_SUBNET_SUBSCRIPTION = 10;
  const ALTAIR_FORK_EPOCH = 1 * EPOCHS_PER_RANDOM_SUBNET_SUBSCRIPTION;
  // eslint-disable-next-line @typescript-eslint/naming-convention
  const config = createIBeaconConfig({ALTAIR_FORK_EPOCH}, ZERO_HASH);
  const {SECONDS_PER_SLOT} = config;

  let service: AttnetsService;

  const sandbox = sinon.createSandbox();
  // let clock: SinonFakeTimers;
  let gossipStub: SinonStubbedInstance<Eth2Gossipsub> & Eth2Gossipsub;
  let randomUtil: SinonStubFn<typeof mathUtils["randBetween"]>;
  let metadata: MetadataController;

  let chain: IBeaconChain;
  let state: allForks.BeaconState;
  const logger = testLogger();
  const subscription: CommitteeSubscription = {
    validatorIndex: 2021,
    subnet: 10,
    slot: 100,
    isAggregator: false,
  };

  beforeEach(function () {
    sandbox.useFakeTimers(Date.now());
    gossipStub = sandbox.createStubInstance(Eth2Gossipsub) as SinonStubbedInstance<Eth2Gossipsub> & Eth2Gossipsub;
    randomUtil = sandbox.stub(mathUtils, "randBetween");
    randomUtil
      .withArgs(EPOCHS_PER_RANDOM_SUBNET_SUBSCRIPTION, 2 * EPOCHS_PER_RANDOM_SUBNET_SUBSCRIPTION)
      .returns(EPOCHS_PER_RANDOM_SUBNET_SUBSCRIPTION + 1);
    randomUtil.withArgs(0, ATTESTATION_SUBNET_COUNT).returns(30);
    randomUtil.withArgs(0, ATTESTATION_SUBNET_COUNT - 1).returns(40);

    // Force shuffle function to not shuffle and just return the original array
    sandbox.stub(shuffleUtils, "shuffle").callsFake((arr) => arr);

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
    service = new AttnetsService(config, chain, gossipStub, metadata, logger);
    service.start();
  });

  afterEach(() => {
    service.stop();
    sandbox.restore();
  });

  it("should not subscribe when there is no active validator", () => {
    chain.emitter.emit(ChainEvent.clockSlot, 1);
    expect(gossipStub.subscribeTopic.called).to.be.false;
  });

  it.skip("should subscribe to RANDOM_SUBNETS_PER_VALIDATOR per 1 validator", () => {
    randomUtil.withArgs(0, ATTESTATION_SUBNET_COUNT).returns(30);
    randomUtil.withArgs(0, ATTESTATION_SUBNET_COUNT - 1).returns(40);
    service.addCommitteeSubscriptions([subscription]);
    expect(gossipStub.subscribeTopic.calledOnce).to.be.true;
    expect(metadata.seqNumber).to.be.equal(BigInt(1));
    // subscribe with a different validator
    subscription.validatorIndex = 2022;
    service.addCommitteeSubscriptions([subscription]);
    expect(gossipStub.subscribeTopic.calledTwice).to.be.true;
    expect(metadata.seqNumber).to.be.equal(BigInt(2));
    // subscribe with same validator
    subscription.validatorIndex = 2021;
    service.addCommitteeSubscriptions([subscription]);
    expect(gossipStub.subscribeTopic.calledTwice).to.be.true;
    expect(metadata.seqNumber).to.be.equal(BigInt(2));
  });

  it("should handle validator expiry", async () => {
    service.addCommitteeSubscriptions([subscription]);
    expect(metadata.seqNumber).to.be.equal(BigInt(1));
    expect(EPOCHS_PER_RANDOM_SUBNET_SUBSCRIPTION * SLOTS_PER_EPOCH).to.be.gt(150);
    sandbox.clock.tick(150 * SLOTS_PER_EPOCH * SECONDS_PER_SLOT * 1000);
    expect(gossipStub.unsubscribeTopic.called).to.be.true;
    // subscribe then unsubscribe
    expect(metadata.seqNumber).to.be.equal(BigInt(2));
  });

  it.skip("should change subnet subscription after 2*EPOCHS_PER_RANDOM_SUBNET_SUBSCRIPTION", async () => {
    service.addCommitteeSubscriptions([subscription]);
    expect(gossipStub.subscribeTopic.calledOnce).to.be.true;
    expect(metadata.seqNumber).to.be.equal(BigInt(1));
    for (let numEpoch = 0; numEpoch < 2 * EPOCHS_PER_RANDOM_SUBNET_SUBSCRIPTION; numEpoch++) {
      // avoid known validator expiry
      service.addCommitteeSubscriptions([subscription]);
      sandbox.clock.tick(SLOTS_PER_EPOCH * SECONDS_PER_SLOT * 1000);
    }
    // may call 2 times, 1 for committee subnet, 1 for random subnet
    expect(gossipStub.unsubscribeTopic.called).to.be.true;
    // subscribe then unsubscribe then subscribe again
    expect(metadata.seqNumber).to.be.equal(BigInt(3));
  });

  it("should prepare for a hard fork", async () => {
    service.addCommitteeSubscriptions([subscription]);

    // Run the pre-fork transition
    service.subscribeSubnetsToNextFork(ForkName.altair);

    // Should have already subscribed to both forks
    const forkTransitionSubscribeCalls = gossipStub.subscribeTopic.getCalls().map((call) => call.args[0]);
    const subToPhase0 = forkTransitionSubscribeCalls.find((topic) => topic.fork === ForkName.phase0);
    const subToAltair = forkTransitionSubscribeCalls.find((topic) => topic.fork === ForkName.altair);
    if (!subToPhase0) throw Error("Must subscribe to one subnet on phase0");
    if (!subToAltair) throw Error("Must subscribe to one subnet on altair");

    // Advance through the fork transition so it un-subscribes from all phase0 subs
    service.unsubscribeSubnetsFromPrevFork(ForkName.phase0);

    const forkTransitionUnSubscribeCalls = gossipStub.unsubscribeTopic.getCalls().map((call) => call.args[0]);
    const unsubbedPhase0Subnets = new Set<number>();
    for (const topic of forkTransitionUnSubscribeCalls) {
      if (topic.fork === ForkName.phase0 && topic.type === GossipType.beacon_attestation)
        unsubbedPhase0Subnets.add(topic.subnet);
    }

    for (let subnet = 0; subnet < ATTESTATION_SUBNET_COUNT; subnet++) {
      expect(unsubbedPhase0Subnets.has(subnet), `Must unsubscribe from all subnets, missing subnet ${subnet}`).true;
    }
  });

  it.skip("handle committee subnet the same to random subnet", () => {
    randomUtil.withArgs(0, ATTESTATION_SUBNET_COUNT).returns(COMMITTEE_SUBNET_SUBSCRIPTION);
    const aggregatorSubscription: CommitteeSubscription = {...subscription, isAggregator: true};
    service.addCommitteeSubscriptions([aggregatorSubscription]);
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
