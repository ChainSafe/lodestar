import {expect} from "chai";
import sinon, {SinonStubbedInstance} from "sinon";
import {createBeaconConfig} from "@lodestar/config";
import {ZERO_HASH} from "@lodestar/state-transition";
import {
  ATTESTATION_SUBNET_COUNT,
  EPOCHS_PER_SUBNET_SUBSCRIPTION,
  ForkName,
  SLOTS_PER_EPOCH,
  SUBNETS_PER_NODE,
} from "@lodestar/params";
import {getCurrentSlot} from "@lodestar/state-transition";
import {bigIntToBytes} from "@lodestar/utils";
import {Clock, IClock} from "../../../../src/util/clock.js";
import {Eth2Gossipsub} from "../../../../src/network/gossip/gossipsub.js";
import {MetadataController} from "../../../../src/network/metadata.js";
import {testLogger} from "../../../utils/logger.js";
import {DLLAttnetsService} from "../../../../src/network/subnets/dllAttnetsService.js";
import {CommitteeSubscription} from "../../../../src/network/subnets/interface.js";

describe("DLLAttnetsService", () => {
  const nodeId = bigIntToBytes(
    BigInt("88752428858350697756262172400162263450541348766581994718383409852729519486397"),
    32,
    "be"
  );
  const ALTAIR_FORK_EPOCH = 100;
  // eslint-disable-next-line @typescript-eslint/naming-convention
  const config = createBeaconConfig({ALTAIR_FORK_EPOCH}, ZERO_HASH);
  // const {SECONDS_PER_SLOT} = config;
  let service: DLLAttnetsService;
  const sandbox = sinon.createSandbox();
  let gossipStub: SinonStubbedInstance<Eth2Gossipsub> & Eth2Gossipsub;
  let metadata: MetadataController;

  let clock: IClock;
  const logger = testLogger();

  beforeEach(function () {
    sandbox.useFakeTimers(Date.now());
    gossipStub = sandbox.createStubInstance(Eth2Gossipsub) as SinonStubbedInstance<Eth2Gossipsub> & Eth2Gossipsub;
    Object.defineProperty(gossipStub, "mesh", {value: new Map()});
    clock = new Clock({
      genesisTime: Math.floor(Date.now() / 1000),
      config,
      signal: new AbortController().signal,
    });

    // load getCurrentSlot first, vscode not able to debug without this
    getCurrentSlot(config, Math.floor(Date.now() / 1000));
    metadata = new MetadataController({}, {config, onSetValue: () => null});
    service = new DLLAttnetsService(config, clock, gossipStub, metadata, logger, null, nodeId, {
      slotsToSubscribeBeforeAggregatorDuty: 2,
    });
  });

  afterEach(() => {
    service.close();
    sandbox.restore();
  });

  it("should subscribe to deterministic long lived subnets on constructor", () => {
    expect(gossipStub.subscribeTopic.calledTwice).to.be.true;
  });

  it("should change long lived subnets after EPOCHS_PER_SUBNET_SUBSCRIPTION", () => {
    expect(gossipStub.subscribeTopic.calledTwice).to.be.true;
    expect(gossipStub.subscribeTopic.callCount).to.be.equal(SUBNETS_PER_NODE);
    sandbox.clock.tick(config.SECONDS_PER_SLOT * SLOTS_PER_EPOCH * EPOCHS_PER_SUBNET_SUBSCRIPTION * 1000);
    // SUBNETS_PER_NODE = 2 => 2 more calls
    expect(gossipStub.subscribeTopic.callCount).to.be.equal(2 * SUBNETS_PER_NODE);
  });

  it("should subscribe to new fork 2 epochs before ALTAIR_FORK_EPOCH", () => {
    expect(gossipStub.subscribeTopic.calledWithMatch({fork: ForkName.phase0})).to.be.true;
    expect(gossipStub.subscribeTopic.calledWithMatch({fork: ForkName.altair})).to.be.false;
    expect(gossipStub.subscribeTopic.calledTwice).to.be.true;
    const firstSubnet = (gossipStub.subscribeTopic.args[0][0] as unknown as {subnet: number}).subnet;
    const secondSubnet = (gossipStub.subscribeTopic.args[1][0] as unknown as {subnet: number}).subnet;
    expect(gossipStub.subscribeTopic.callCount).to.be.equal(SUBNETS_PER_NODE);
    sandbox.clock.tick(config.SECONDS_PER_SLOT * SLOTS_PER_EPOCH * (ALTAIR_FORK_EPOCH - 2) * 1000);
    service.subscribeSubnetsToNextFork(ForkName.altair);
    // SUBNETS_PER_NODE = 2 => 2 more calls
    // same subnets were called
    expect(gossipStub.subscribeTopic.calledWithMatch({fork: ForkName.altair, subnet: firstSubnet})).to.be.true;
    expect(gossipStub.subscribeTopic.calledWithMatch({fork: ForkName.altair, subnet: secondSubnet})).to.be.true;
    expect(gossipStub.subscribeTopic.callCount).to.be.equal(2 * SUBNETS_PER_NODE);
    // 2 epochs after the fork
    sandbox.clock.tick(config.SECONDS_PER_SLOT * 4 * 1000);
    service.unsubscribeSubnetsFromPrevFork(ForkName.phase0);
    expect(gossipStub.unsubscribeTopic.calledWithMatch({fork: ForkName.phase0, subnet: firstSubnet})).to.be.true;
    expect(gossipStub.unsubscribeTopic.calledWithMatch({fork: ForkName.phase0, subnet: secondSubnet})).to.be.true;
    expect(gossipStub.unsubscribeTopic.callCount).to.be.equal(ATTESTATION_SUBNET_COUNT);
  });

  it("should not subscribe to new short lived subnet if not aggregator", () => {
    expect(gossipStub.subscribeTopic.callCount).to.be.equal(SUBNETS_PER_NODE);
    const firstSubnet = (gossipStub.subscribeTopic.args[0][0] as unknown as {subnet: number}).subnet;
    const secondSubnet = (gossipStub.subscribeTopic.args[1][0] as unknown as {subnet: number}).subnet;
    // should subscribe to new short lived subnet
    const newSubnet = 63;
    expect(newSubnet).to.be.not.equal(firstSubnet);
    expect(newSubnet).to.be.not.equal(secondSubnet);
    const subscription: CommitteeSubscription = {
      validatorIndex: 2023,
      subnet: newSubnet,
      slot: 100,
      isAggregator: false,
    };
    service.addCommitteeSubscriptions([subscription]);
    // no new subscription
    expect(gossipStub.subscribeTopic.callCount).to.be.equal(SUBNETS_PER_NODE);
  });

  it("should subscribe to new short lived subnet if aggregator", () => {
    expect(gossipStub.subscribeTopic.callCount).to.be.equal(SUBNETS_PER_NODE);
    const firstSubnet = (gossipStub.subscribeTopic.args[0][0] as unknown as {subnet: number}).subnet;
    const secondSubnet = (gossipStub.subscribeTopic.args[1][0] as unknown as {subnet: number}).subnet;
    // should subscribe to new short lived subnet
    const newSubnet = 63;
    expect(newSubnet).to.be.not.equal(firstSubnet);
    expect(newSubnet).to.be.not.equal(secondSubnet);
    const subscription: CommitteeSubscription = {
      validatorIndex: 2023,
      subnet: newSubnet,
      slot: 100,
      isAggregator: true,
    };
    service.addCommitteeSubscriptions([subscription]);
    // it does not subscribe immediately
    expect(gossipStub.subscribeTopic.callCount).to.be.equal(SUBNETS_PER_NODE);
    sandbox.clock.tick(config.SECONDS_PER_SLOT * (subscription.slot - 2) * 1000);
    // then subscribe 2 slots before dutied slot
    expect(gossipStub.subscribeTopic.callCount).to.be.equal(SUBNETS_PER_NODE + 1);
    // then unsubscribe after the expiration
    sandbox.clock.tick(config.SECONDS_PER_SLOT * (subscription.slot + 1) * 1000);
    expect(gossipStub.unsubscribeTopic.calledWithMatch({subnet: newSubnet})).to.be.true;
  });

  it("should not subscribe to existing short lived subnet if aggregator", () => {
    expect(gossipStub.subscribeTopic.callCount).to.be.equal(SUBNETS_PER_NODE);
    const firstSubnet = (gossipStub.subscribeTopic.args[0][0] as unknown as {subnet: number}).subnet;
    // should not subscribe to existing short lived subnet
    const subscription: CommitteeSubscription = {
      validatorIndex: 2023,
      subnet: firstSubnet,
      slot: 100,
      isAggregator: true,
    };
    service.addCommitteeSubscriptions([subscription]);
    expect(gossipStub.subscribeTopic.callCount).to.be.equal(SUBNETS_PER_NODE);
    // then should not subscribe after the expiration
    sandbox.clock.tick(config.SECONDS_PER_SLOT * (subscription.slot + 1) * 1000);
    expect(gossipStub.unsubscribeTopic.called).to.be.false;
  });
});
