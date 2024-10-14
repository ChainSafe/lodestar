import {describe, it, expect, beforeEach, vi, MockedObject, afterEach} from "vitest";
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
import {AttnetsService} from "../../../../src/network/subnets/attnetsService.js";
import {CommitteeSubscription} from "../../../../src/network/subnets/interface.js";

vi.mock("../../../../src/network/gossip/gossipsub.js");

describe("AttnetsService", () => {
  const nodeId = bigIntToBytes(
    BigInt("88752428858350697756262172400162263450541348766581994718383409852729519486397"),
    32,
    "be"
  );
  const ALTAIR_FORK_EPOCH = 100;
  const config = createBeaconConfig({ALTAIR_FORK_EPOCH}, ZERO_HASH);
  // const {SECONDS_PER_SLOT} = config;
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
    metadata = new MetadataController({}, {config, onSetValue: () => null});
    service = new AttnetsService(config, clock, gossipStub, metadata, logger, null, nodeId, {
      slotsToSubscribeBeforeAggregatorDuty: 2,
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
    expect(gossipStub.subscribeTopic).toBeCalledTimes(SUBNETS_PER_NODE);
    vi.advanceTimersByTime(config.SECONDS_PER_SLOT * SLOTS_PER_EPOCH * EPOCHS_PER_SUBNET_SUBSCRIPTION * 1000);
    // SUBNETS_PER_NODE = 2 => 2 more calls
    expect(gossipStub.subscribeTopic).toBeCalledTimes(2 * SUBNETS_PER_NODE);
  });

  it("should subscribe to new fork 2 epochs before ALTAIR_FORK_EPOCH", () => {
    expect(gossipStub.subscribeTopic).toBeCalledWith(expect.objectContaining({fork: ForkName.phase0}));
    expect(gossipStub.subscribeTopic).not.toBeCalledWith({fork: ForkName.altair});
    expect(gossipStub.subscribeTopic).toBeCalledTimes(2);
    const firstSubnet = (gossipStub.subscribeTopic.mock.calls[0][0] as unknown as {subnet: number}).subnet;
    const secondSubnet = (gossipStub.subscribeTopic.mock.calls[1][0] as unknown as {subnet: number}).subnet;
    expect(gossipStub.subscribeTopic).toBeCalledTimes(SUBNETS_PER_NODE);
    vi.advanceTimersByTime(config.SECONDS_PER_SLOT * SLOTS_PER_EPOCH * (ALTAIR_FORK_EPOCH - 2) * 1000);
    service.subscribeSubnetsToNextFork(ForkName.altair);
    // SUBNETS_PER_NODE = 2 => 2 more calls
    // same subnets were called
    expect(gossipStub.subscribeTopic).toHaveBeenCalledWith(
      expect.objectContaining({fork: ForkName.altair, subnet: firstSubnet})
    );
    expect(gossipStub.subscribeTopic).toHaveBeenCalledWith(
      expect.objectContaining({fork: ForkName.altair, subnet: secondSubnet})
    );
    expect(gossipStub.subscribeTopic).toBeCalledTimes(2 * SUBNETS_PER_NODE);
    // 2 epochs after the fork
    vi.advanceTimersByTime(config.SECONDS_PER_SLOT * 4 * 1000);
    service.unsubscribeSubnetsFromPrevFork(ForkName.phase0);
    expect(gossipStub.unsubscribeTopic).toHaveBeenCalledWith(
      expect.objectContaining({fork: ForkName.phase0, subnet: firstSubnet})
    );
    expect(gossipStub.unsubscribeTopic).toHaveBeenCalledWith(
      expect.objectContaining({fork: ForkName.phase0, subnet: secondSubnet})
    );
    expect(gossipStub.unsubscribeTopic).toBeCalledTimes(ATTESTATION_SUBNET_COUNT);
  });

  it("should not subscribe to new short lived subnet if not aggregator", () => {
    expect(gossipStub.subscribeTopic).toBeCalledTimes(SUBNETS_PER_NODE);
    const firstSubnet = (gossipStub.subscribeTopic.mock.calls[0][0] as unknown as {subnet: number}).subnet;
    const secondSubnet = (gossipStub.subscribeTopic.mock.calls[1][0] as unknown as {subnet: number}).subnet;
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
    expect(gossipStub.subscribeTopic).toBeCalledTimes(SUBNETS_PER_NODE);
  });

  it("should subscribe to new short lived subnet if aggregator", () => {
    expect(gossipStub.subscribeTopic).toBeCalledTimes(SUBNETS_PER_NODE);
    const firstSubnet = (gossipStub.subscribeTopic.mock.calls[0][0] as unknown as {subnet: number}).subnet;
    const secondSubnet = (gossipStub.subscribeTopic.mock.calls[1][0] as unknown as {subnet: number}).subnet;
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
    expect(gossipStub.subscribeTopic).toBeCalledTimes(SUBNETS_PER_NODE);
    vi.advanceTimersByTime(config.SECONDS_PER_SLOT * (subscription.slot - 2) * 1000);
    // then subscribe 2 slots before dutied slot
    expect(gossipStub.subscribeTopic).toBeCalledTimes(SUBNETS_PER_NODE + 1);
    // then unsubscribe after the expiration
    vi.advanceTimersByTime(config.SECONDS_PER_SLOT * (subscription.slot + 1) * 1000);
    expect(gossipStub.unsubscribeTopic).toHaveBeenCalledWith(expect.objectContaining({subnet: newSubnet}));
  });

  it("should not subscribe to existing short lived subnet if aggregator", () => {
    expect(gossipStub.subscribeTopic).toBeCalledTimes(SUBNETS_PER_NODE);
    const firstSubnet = (gossipStub.subscribeTopic.mock.calls[0][0] as unknown as {subnet: number}).subnet;
    // should not subscribe to existing short lived subnet
    const subscription: CommitteeSubscription = {
      validatorIndex: 2023,
      subnet: firstSubnet,
      slot: 100,
      isAggregator: true,
    };
    service.addCommitteeSubscriptions([subscription]);
    expect(gossipStub.subscribeTopic).toBeCalledTimes(SUBNETS_PER_NODE);
    // then should not subscribe after the expiration
    vi.advanceTimersByTime(config.SECONDS_PER_SLOT * (subscription.slot + 1) * 1000);
    expect(gossipStub.unsubscribeTopic).not.toHaveBeenCalled();
  });
});
