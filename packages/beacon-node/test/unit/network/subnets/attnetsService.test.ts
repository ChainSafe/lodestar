import {describe, it, expect, beforeEach, afterEach, vi, MockedObject} from "vitest";
import {
  ATTESTATION_SUBNET_COUNT,
  EPOCHS_PER_RANDOM_SUBNET_SUBSCRIPTION,
  ForkName,
  SLOTS_PER_EPOCH,
} from "@lodestar/params";
import {createBeaconConfig} from "@lodestar/config";
import {getCurrentSlot} from "@lodestar/state-transition";
import {testLogger} from "../../../utils/logger.js";
import {MetadataController} from "../../../../src/network/metadata.js";
import {Eth2Gossipsub, GossipType} from "../../../../src/network/gossip/index.js";
import {AttnetsService, CommitteeSubscription, ShuffleFn} from "../../../../src/network/subnets/index.js";
import {ClockEvent} from "../../../../src/util/clock.js";
import {ZERO_HASH} from "../../../../src/constants/index.js";
import {IClock} from "../../../../src/util/clock.js";
import {Clock} from "../../../../src/util/clock.js";

vi.mock("../../../../src/network/gossip/index.js");

describe("AttnetsService", function () {
  const COMMITTEE_SUBNET_SUBSCRIPTION = 10;
  const ALTAIR_FORK_EPOCH = 1 * EPOCHS_PER_RANDOM_SUBNET_SUBSCRIPTION;
  // eslint-disable-next-line @typescript-eslint/naming-convention
  const config = createBeaconConfig({ALTAIR_FORK_EPOCH}, ZERO_HASH);
  const {SECONDS_PER_SLOT} = config;

  let service: AttnetsService;

  let gossipStub: MockedObject<Eth2Gossipsub>;
  let metadata: MetadataController;

  let clock: IClock;
  const logger = testLogger();
  const subscription: CommitteeSubscription = {
    validatorIndex: 2021,
    subnet: COMMITTEE_SUBNET_SUBSCRIPTION,
    slot: 100,
    isAggregator: false,
  };
  const numEpochRandomSubscription = EPOCHS_PER_RANDOM_SUBNET_SUBSCRIPTION + 1;
  // at middle of epoch
  const startSlot = Math.floor(SLOTS_PER_EPOCH / 2);
  // test case may decide this value based on its business logic
  let randomSubnet = 0;

  beforeEach(function () {
    vi.useFakeTimers({now: Date.now()});
    gossipStub = vi.mocked(new Eth2Gossipsub({} as any, {} as any));
    vi.spyOn(gossipStub, "subscribeTopic").mockReturnValue();
    vi.spyOn(gossipStub, "unsubscribeTopic").mockReturnValue();

    const randBetweenFn = (min: number, max: number): number => {
      if (min === EPOCHS_PER_RANDOM_SUBNET_SUBSCRIPTION && max === 2 * EPOCHS_PER_RANDOM_SUBNET_SUBSCRIPTION) {
        return numEpochRandomSubscription;
      }

      throw Error(`Not expected min=${min} and max=${max}`);
    };

    // shuffle function to return randomSubnet and increase its value
    function shuffleFn(arr: number[]): number[] {
      return [randomSubnet++ % ATTESTATION_SUBNET_COUNT, ...arr];
    }

    clock = new Clock({
      genesisTime: Math.floor(Date.now() / 1000 - config.SECONDS_PER_SLOT * startSlot),
      config,
      signal: new AbortController().signal,
    });

    // load getCurrentSlot first, vscode not able to debug without this
    getCurrentSlot(config, Math.floor(Date.now() / 1000));
    metadata = new MetadataController({}, {config, onSetValue: () => null});
    service = new AttnetsService(config, clock, gossipStub, metadata, logger, null, {
      slotsToSubscribeBeforeAggregatorDuty: 2,
      randBetweenFn,
      shuffleFn: shuffleFn as ShuffleFn,
    });
  });

  afterEach(() => {
    service.close();
    randomSubnet = 0;
    vi.clearAllMocks();
    vi.clearAllTimers();
  });

  it("should not subscribe when there is no active validator", () => {
    clock.emit(ClockEvent.slot, 1);
    expect(gossipStub.subscribeTopic).not.toHaveBeenCalled();
  });

  it("should subscribe to RANDOM_SUBNETS_PER_VALIDATOR per 1 validator", () => {
    service.addCommitteeSubscriptions([subscription]);
    expect(gossipStub.subscribeTopic).toHaveBeenCalledTimes(1);
    expect(metadata.seqNumber).toBe(BigInt(1));
    // subscribe with a different validator
    subscription.validatorIndex = 2022;
    service.addCommitteeSubscriptions([subscription]);
    expect(gossipStub.subscribeTopic).toHaveBeenCalledTimes(2);
    expect(metadata.seqNumber).toBe(BigInt(2));
    // subscribe with same validator
    subscription.validatorIndex = 2021;
    service.addCommitteeSubscriptions([subscription]);
    expect(gossipStub.subscribeTopic).toHaveBeenCalledTimes(2);
    expect(metadata.seqNumber).toBe(BigInt(2));
  });

  it("should handle validator expiry", async () => {
    service.addCommitteeSubscriptions([subscription]);
    expect(metadata.seqNumber).toBe(BigInt(1));
    expect(EPOCHS_PER_RANDOM_SUBNET_SUBSCRIPTION * SLOTS_PER_EPOCH).toBeGreaterThan(150);
    vi.advanceTimersByTime(150 * SLOTS_PER_EPOCH * SECONDS_PER_SLOT * 1000);
    expect(gossipStub.unsubscribeTopic).toHaveBeenCalledOnce();
    // subscribe then unsubscribe
    expect(metadata.seqNumber).toBe(BigInt(2));
  });

  it("should change subnet subscription after 2*EPOCHS_PER_RANDOM_SUBNET_SUBSCRIPTION", async () => {
    service.addCommitteeSubscriptions([subscription]);
    expect(gossipStub.subscribeTopic).toBeCalledTimes(1);
    expect(metadata.seqNumber).toBe(BigInt(1));
    for (let numEpoch = 0; numEpoch <= numEpochRandomSubscription; numEpoch++) {
      // avoid known validator expiry
      service.addCommitteeSubscriptions([subscription]);
      vi.advanceTimersByTime(SLOTS_PER_EPOCH * SECONDS_PER_SLOT * 1000);
    }
    // may call 2 times, 1 for committee subnet, 1 for random subnet
    expect(gossipStub.unsubscribeTopic).toHaveBeenCalledWith(expect.any(Object));
    // rebalanced twice
    expect(metadata.seqNumber).toBe(BigInt(2));
  });

  // Reproduce issue https://github.com/ChainSafe/lodestar/issues/4929
  it("should NOT unsubscribe any subnet if there are 64 known validators", async () => {
    expect(clock.currentSlot).toBe(startSlot);
    // after random subnet expiration but before the next epoch
    const tcSubscription = {
      ...subscription,
      slot: startSlot + numEpochRandomSubscription * SLOTS_PER_EPOCH + 1,
      isAggregator: true,
    };
    // expect to subscribe to all random subnets
    const subscriptions = Array.from({length: ATTESTATION_SUBNET_COUNT}, (_, i) => ({
      ...tcSubscription,
      validatorIndex: i,
    }));
    service.addCommitteeSubscriptions(subscriptions);
    for (let numEpoch = 0; numEpoch < numEpochRandomSubscription; numEpoch++) {
      // avoid known validator expiry
      service.addCommitteeSubscriptions(subscriptions);
      vi.advanceTimersByTime(SLOTS_PER_EPOCH * SECONDS_PER_SLOT * 1000);
    }
    // tick 3 next slots to expect an attempt to expire committee subscription
    vi.advanceTimersByTime(3 * SECONDS_PER_SLOT * 1000);
    // should not unsubscribe any subnet topics as we have ATTESTATION_SUBNET_COUNT subscription
    expect(gossipStub.unsubscribeTopic).not.toBeCalled();
  });

  it("should prepare for a hard fork", async () => {
    service.addCommitteeSubscriptions([subscription]);

    // Run the pre-fork transition
    service.subscribeSubnetsToNextFork(ForkName.altair);

    // Should have already subscribed to both forks
    const forkTransitionSubscribeCalls = gossipStub.subscribeTopic.mock.calls.map((call) => call[0]);
    const subToPhase0 = forkTransitionSubscribeCalls.find((topic) => topic.fork === ForkName.phase0);
    const subToAltair = forkTransitionSubscribeCalls.find((topic) => topic.fork === ForkName.altair);
    if (!subToPhase0) throw Error("Must subscribe to one subnet on phase0");
    if (!subToAltair) throw Error("Must subscribe to one subnet on altair");

    // Advance through the fork transition so it un-subscribes from all phase0 subs
    service.unsubscribeSubnetsFromPrevFork(ForkName.phase0);

    const forkTransitionUnSubscribeCalls = gossipStub.unsubscribeTopic.mock.calls.map((call) => call[0]);
    const unsubbedPhase0Subnets = new Set<number>();
    for (const topic of forkTransitionUnSubscribeCalls) {
      if (topic.fork === ForkName.phase0 && topic.type === GossipType.beacon_attestation)
        unsubbedPhase0Subnets.add(topic.subnet);
    }

    for (let subnet = 0; subnet < ATTESTATION_SUBNET_COUNT; subnet++) {
      // Must unsubscribe from all subnets, missing subnet ${subnet}
      expect(unsubbedPhase0Subnets.has(subnet)).toBe(true);
    }
  });

  it("handle committee subnet the same to random subnet", () => {
    // randomUtil.withArgs(0, ATTESTATION_SUBNET_COUNT).mockReturnValue(COMMITTEE_SUBNET_SUBSCRIPTION);
    randomSubnet = COMMITTEE_SUBNET_SUBSCRIPTION;
    const aggregatorSubscription: CommitteeSubscription = {...subscription, isAggregator: true};
    service.addCommitteeSubscriptions([aggregatorSubscription]);
    expect(service.shouldProcess(subscription.subnet, subscription.slot)).toBe(true);
    expect(service.getActiveSubnets()).toEqual([{subnet: COMMITTEE_SUBNET_SUBSCRIPTION, toSlot: 101}]);
    // committee subnet is same to random subnet
    expect(gossipStub.subscribeTopic).toHaveBeenCalledTimes(1);
    expect(metadata.seqNumber).toBe(BigInt(1));
    // pass through subscription slot
    vi.advanceTimersByTime((aggregatorSubscription.slot + 2) * SECONDS_PER_SLOT * 1000);
    // don't unsubscribe bc random subnet is still there
    expect(gossipStub.unsubscribeTopic).not.toHaveBeenCalled();
  });

  it("should not process if no aggregator at dutied slot", () => {
    expect(subscription.isAggregator).toBe(false);
    service.addCommitteeSubscriptions([subscription]);
    expect(service.shouldProcess(subscription.subnet, subscription.slot)).toBe(false);
  });
});
