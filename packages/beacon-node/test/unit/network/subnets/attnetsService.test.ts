import {MockedObject, afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {createBeaconConfig} from "@lodestar/config";
import {testLogger} from "@lodestar/logger/test-utils";
import {ATTESTATION_SUBNET_COUNT, ForkName, GENESIS_EPOCH, SLOTS_PER_EPOCH} from "@lodestar/params";
import {ZERO_HASH, getCurrentSlot} from "@lodestar/state-transition";
import {SubnetID} from "@lodestar/types";
import {bigIntToBytes} from "@lodestar/utils";
import {Eth2Gossipsub} from "../../../../src/network/gossip/gossipsub.js";
import {MetadataController} from "../../../../src/network/metadata.js";
import {NetworkConfig} from "../../../../src/network/networkConfig.js";
import {AttnetsService} from "../../../../src/network/subnets/attnetsService.js";
import {CommitteeSubscription} from "../../../../src/network/subnets/interface.js";
import {Clock, IClock} from "../../../../src/util/clock.js";
import {CustodyConfig} from "../../../../src/util/dataColumns.js";

vi.mock("../../../../src/network/gossip/gossipsub.js");

describe("AttnetsService", () => {
  const nodeId = bigIntToBytes(
    BigInt("88752428858350697756262172400162263450541348766581994718383409852729519486397"),
    32,
    "be"
  );
  const ALTAIR_FORK_EPOCH = 100;
  const config = createBeaconConfig({ALTAIR_FORK_EPOCH}, ZERO_HASH);
  const networkConfig: NetworkConfig = {
    nodeId,
    config,
    custodyConfig: new CustodyConfig({
      nodeId,
      config,
    }),
  };

  let service: AttnetsService;
  let gossipStub: MockedObject<Eth2Gossipsub>;
  let metadata: MetadataController;

  let clock: IClock;
  const logger = testLogger();

  beforeEach(() => {
    vi.useFakeTimers({now: Date.now()});
    gossipStub = vi.mocked(new Eth2Gossipsub({} as any, {} as any));
    vi.spyOn(gossipStub, "subscribeTopic").mockReturnValue(undefined);
    vi.spyOn(gossipStub, "unsubscribeTopic").mockReturnValue(undefined);

    Object.defineProperty(gossipStub, "mesh", {value: new Map()});
    clock = new Clock({
      genesisTime: Math.floor(Date.now() / 1000),
      config,
      signal: new AbortController().signal,
    });

    // load getCurrentSlot first, vscode not able to debug without this
    getCurrentSlot(config, Math.floor(Date.now() / 1000));
    metadata = new MetadataController({}, {networkConfig, logger, onSetValue: () => null});
    service = new AttnetsService(config, clock, gossipStub, metadata, logger, null, nodeId, {
      slotsToSubscribeBeforeAggregatorDuty: 2,
      slotsToSubscribeBeforeProposalDuty: 0,
    });
  });

  afterEach(() => {
    service.close();
    vi.clearAllMocks();
  });

  it("should subscribe to deterministic long lived subnets on constructor", () => {
    expect(gossipStub.subscribeTopic).toBeCalledTimes(2);
  });

  it("should change long lived subnets after EPOCHS_PER_SUBNET_SUBSCRIPTION", () => {
    expect(gossipStub.subscribeTopic).toBeCalledTimes(2);
    expect(gossipStub.subscribeTopic).toBeCalledTimes(config.SUBNETS_PER_NODE);
    vi.advanceTimersByTime(config.SLOT_DURATION_MS * SLOTS_PER_EPOCH * config.EPOCHS_PER_SUBNET_SUBSCRIPTION);
    // SUBNETS_PER_NODE = 2 => 2 more calls
    expect(gossipStub.subscribeTopic).toBeCalledTimes(2 * config.SUBNETS_PER_NODE);
  });

  it("should subscribe to new fork 2 epochs before ALTAIR_FORK_EPOCH", () => {
    expect(gossipStub.subscribeTopic).toBeCalledWith(
      expect.objectContaining({boundary: {fork: ForkName.phase0, epoch: GENESIS_EPOCH}})
    );
    expect(gossipStub.subscribeTopic).not.toBeCalledWith({
      boundary: {fork: ForkName.altair, epoch: config.ALTAIR_FORK_EPOCH},
    });
    expect(gossipStub.subscribeTopic).toBeCalledTimes(2);
    const firstSubnet = (gossipStub.subscribeTopic.mock.calls[0][0] as unknown as {subnet: SubnetID}).subnet;
    const secondSubnet = (gossipStub.subscribeTopic.mock.calls[1][0] as unknown as {subnet: SubnetID}).subnet;
    expect(gossipStub.subscribeTopic).toBeCalledTimes(config.SUBNETS_PER_NODE);
    vi.advanceTimersByTime(config.SLOT_DURATION_MS * SLOTS_PER_EPOCH * (ALTAIR_FORK_EPOCH - 2));
    service.subscribeSubnetsNextBoundary({fork: ForkName.altair, epoch: config.ALTAIR_FORK_EPOCH});
    // SUBNETS_PER_NODE = 2 => 2 more calls
    // same subnets were called
    expect(gossipStub.subscribeTopic).toHaveBeenCalledWith(
      expect.objectContaining({boundary: {fork: ForkName.altair, epoch: config.ALTAIR_FORK_EPOCH}, subnet: firstSubnet})
    );
    expect(gossipStub.subscribeTopic).toHaveBeenCalledWith(
      expect.objectContaining({
        boundary: {fork: ForkName.altair, epoch: config.ALTAIR_FORK_EPOCH},
        subnet: secondSubnet,
      })
    );
    expect(gossipStub.subscribeTopic).toBeCalledTimes(2 * config.SUBNETS_PER_NODE);
    // 2 epochs after the fork
    vi.advanceTimersByTime(config.SLOT_DURATION_MS * 4);
    service.unsubscribeSubnetsPrevBoundary({fork: ForkName.phase0, epoch: GENESIS_EPOCH});
    expect(gossipStub.unsubscribeTopic).toHaveBeenCalledWith(
      expect.objectContaining({boundary: {fork: ForkName.phase0, epoch: GENESIS_EPOCH}, subnet: firstSubnet})
    );
    expect(gossipStub.unsubscribeTopic).toHaveBeenCalledWith(
      expect.objectContaining({boundary: {fork: ForkName.phase0, epoch: GENESIS_EPOCH}, subnet: secondSubnet})
    );
    expect(gossipStub.unsubscribeTopic).toBeCalledTimes(ATTESTATION_SUBNET_COUNT);
  });

  it("should not subscribe to new short lived subnet if not aggregator", () => {
    expect(gossipStub.subscribeTopic).toBeCalledTimes(config.SUBNETS_PER_NODE);
    const firstSubnet = (gossipStub.subscribeTopic.mock.calls[0][0] as unknown as {subnet: SubnetID}).subnet;
    const secondSubnet = (gossipStub.subscribeTopic.mock.calls[1][0] as unknown as {subnet: SubnetID}).subnet;
    // should subscribe to new short lived subnet
    const newSubnet = 63;
    expect(newSubnet).not.toBe(firstSubnet);
    expect(newSubnet).not.toBe(secondSubnet);
    const subscription: CommitteeSubscription = {
      validatorIndex: 2023,
      subnet: newSubnet,
      slot: 100,
      isAggregator: false,
    };
    service.addCommitteeSubscriptions([subscription]);
    // no new subscription
    expect(gossipStub.subscribeTopic).toBeCalledTimes(config.SUBNETS_PER_NODE);
  });

  it("should subscribe to new short lived subnet if aggregator", () => {
    expect(gossipStub.subscribeTopic).toBeCalledTimes(config.SUBNETS_PER_NODE);
    const firstSubnet = (gossipStub.subscribeTopic.mock.calls[0][0] as unknown as {subnet: SubnetID}).subnet;
    const secondSubnet = (gossipStub.subscribeTopic.mock.calls[1][0] as unknown as {subnet: SubnetID}).subnet;
    // should subscribe to new short lived subnet
    const newSubnet = 63;
    expect(newSubnet).not.toBe(firstSubnet);
    expect(newSubnet).not.toBe(secondSubnet);
    const subscription: CommitteeSubscription = {
      validatorIndex: 2023,
      subnet: newSubnet,
      slot: 100,
      isAggregator: true,
    };
    service.addCommitteeSubscriptions([subscription]);
    // it does not subscribe immediately
    expect(gossipStub.subscribeTopic).toBeCalledTimes(config.SUBNETS_PER_NODE);
    vi.advanceTimersByTime(config.SLOT_DURATION_MS * (subscription.slot - 2));
    // then subscribe 2 slots before dutied slot
    expect(gossipStub.subscribeTopic).toBeCalledTimes(config.SUBNETS_PER_NODE + 1);
    // then unsubscribe after the expiration
    vi.advanceTimersByTime(config.SLOT_DURATION_MS * (subscription.slot + 1));
    expect(gossipStub.unsubscribeTopic).toHaveBeenCalledWith(expect.objectContaining({subnet: newSubnet}));
  });

  it("should not subscribe to existing short lived subnet if aggregator", () => {
    expect(gossipStub.subscribeTopic).toBeCalledTimes(config.SUBNETS_PER_NODE);
    const firstSubnet = (gossipStub.subscribeTopic.mock.calls[0][0] as unknown as {subnet: SubnetID}).subnet;
    // should not subscribe to existing short lived subnet
    const subscription: CommitteeSubscription = {
      validatorIndex: 2023,
      subnet: firstSubnet,
      slot: 100,
      isAggregator: true,
    };
    service.addCommitteeSubscriptions([subscription]);
    expect(gossipStub.subscribeTopic).toBeCalledTimes(config.SUBNETS_PER_NODE);
    // then should not subscribe after the expiration
    vi.advanceTimersByTime(config.SLOT_DURATION_MS * (subscription.slot + 1));
    expect(gossipStub.unsubscribeTopic).not.toHaveBeenCalled();
  });

  describe("before a local block proposal", () => {
    const slotsToSubscribeBeforeProposalDuty = 4;
    const proposalSlot = 100;
    const halfSlotMs = config.SLOT_DURATION_MS / 2;

    beforeEach(() => {
      service.close();
      vi.clearAllMocks();
      service = new AttnetsService(config, clock, gossipStub, metadata, logger, null, nodeId, {
        slotsToSubscribeBeforeAggregatorDuty: 2,
        slotsToSubscribeBeforeProposalDuty,
      });
    });

    function getSubnets(calls: unknown[][]): SubnetID[] {
      return calls.map((call) => (call[0] as {subnet: SubnetID}).subnet);
    }

    it("subscribes to all subnets N slots before and unsubscribes at half of the slot before", () => {
      const longLivedSubnets = getSubnets(gossipStub.subscribeTopic.mock.calls);
      expect(longLivedSubnets.length).toBe(config.SUBNETS_PER_NODE);
      service.addLocalProposalSlots([proposalSlot]);

      vi.advanceTimersByTime(config.SLOT_DURATION_MS * (proposalSlot - slotsToSubscribeBeforeProposalDuty - 1));
      expect(gossipStub.subscribeTopic).toBeCalledTimes(config.SUBNETS_PER_NODE);

      // all other subnets are subscribed N slots before the proposal, without discovery
      vi.advanceTimersByTime(config.SLOT_DURATION_MS);
      expect(gossipStub.subscribeTopic).toBeCalledTimes(ATTESTATION_SUBNET_COUNT);
      expect(service.getActiveSubnets().length).toBe(config.SUBNETS_PER_NODE);

      // still subscribed at the start of the slot before the proposal
      vi.advanceTimersByTime(config.SLOT_DURATION_MS * (slotsToSubscribeBeforeProposalDuty - 1));
      expect(gossipStub.unsubscribeTopic).not.toHaveBeenCalled();

      // unsubscribed at half of the slot before the proposal, except long-lived subnets
      vi.advanceTimersByTime(halfSlotMs);
      expect(gossipStub.unsubscribeTopic).toBeCalledTimes(ATTESTATION_SUBNET_COUNT - config.SUBNETS_PER_NODE);
      const unsubscribedSubnets = getSubnets(gossipStub.unsubscribeTopic.mock.calls);
      for (const subnet of longLivedSubnets) {
        expect(unsubscribedSubnets).not.toContain(subnet);
      }
    });

    it("keeps a subnet with an aggregator duty in the slot before the proposal until the next slot", () => {
      const aggregatorSubnet = 63;
      expect(getSubnets(gossipStub.subscribeTopic.mock.calls)).not.toContain(aggregatorSubnet);
      service.addLocalProposalSlots([proposalSlot]);
      service.addCommitteeSubscriptions([
        {validatorIndex: 2023, subnet: aggregatorSubnet, slot: proposalSlot - 1, isAggregator: true},
      ]);

      vi.advanceTimersByTime(config.SLOT_DURATION_MS * (proposalSlot - 1) + halfSlotMs);
      expect(getSubnets(gossipStub.unsubscribeTopic.mock.calls)).not.toContain(aggregatorSubnet);

      vi.advanceTimersByTime(halfSlotMs);
      expect(getSubnets(gossipStub.unsubscribeTopic.mock.calls)).toContain(aggregatorSubnet);
    });

    it("keeps subnets subscribed when a later proposal window overlaps", () => {
      service.addLocalProposalSlots([proposalSlot, proposalSlot + 2]);

      vi.advanceTimersByTime(config.SLOT_DURATION_MS * (proposalSlot - 1) + halfSlotMs);
      expect(gossipStub.unsubscribeTopic).not.toHaveBeenCalled();

      vi.advanceTimersByTime(config.SLOT_DURATION_MS * 2);
      expect(gossipStub.unsubscribeTopic).toBeCalledTimes(ATTESTATION_SUBNET_COUNT - config.SUBNETS_PER_NODE);
      // subscribed only once
      expect(gossipStub.subscribeTopic).toBeCalledTimes(ATTESTATION_SUBNET_COUNT);
    });

    it("subscribes right away to a proposal learned inside its window", () => {
      vi.advanceTimersByTime(config.SLOT_DURATION_MS * (proposalSlot - 3));
      expect(gossipStub.subscribeTopic).toBeCalledTimes(config.SUBNETS_PER_NODE);

      service.addLocalProposalSlots([proposalSlot]);
      expect(gossipStub.subscribeTopic).toBeCalledTimes(ATTESTATION_SUBNET_COUNT);

      // same expiry as a proposal known in time
      vi.advanceTimersByTime(config.SLOT_DURATION_MS * 2 + halfSlotMs);
      expect(gossipStub.unsubscribeTopic).toBeCalledTimes(ATTESTATION_SUBNET_COUNT - config.SUBNETS_PER_NODE);
    });

    it("does not subscribe to a proposal learned in the slot before it", () => {
      vi.advanceTimersByTime(config.SLOT_DURATION_MS * (proposalSlot - 1));
      service.addLocalProposalSlots([proposalSlot]);
      expect(gossipStub.subscribeTopic).toBeCalledTimes(config.SUBNETS_PER_NODE);
    });
  });
});
