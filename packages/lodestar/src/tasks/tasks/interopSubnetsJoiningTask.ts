import {INetwork} from "../../network";
import {IBeaconConfig, ForkName} from "@chainsafe/lodestar-config";
import {ATTESTATION_SUBNET_COUNT} from "../../constants";
import {randBetween, ILogger} from "@chainsafe/lodestar-utils";
import {ChainEvent, IBeaconChain} from "../../chain";
import {GossipType} from "../../network/gossip";

export interface IInteropSubnetsJoiningModules {
  network: INetwork;
  chain: IBeaconChain;
  logger: ILogger;
}

export class InteropSubnetsJoiningTask {
  private readonly config: IBeaconConfig;
  private readonly network: INetwork;
  private readonly chain: IBeaconChain;
  private readonly logger: ILogger;
  private currentSubnets: Set<number>;
  private nextForkSubnets: Set<number>;
  private currentFork!: ForkName;

  private currentTimers: NodeJS.Timeout[] = [];
  private nextForkTimers: NodeJS.Timeout[] = [];
  private nextForkSubsTimer?: NodeJS.Timeout;

  constructor(config: IBeaconConfig, modules: IInteropSubnetsJoiningModules) {
    this.config = config;
    this.network = modules.network;
    this.chain = modules.chain;
    this.logger = modules.logger;
    this.currentSubnets = new Set();
    this.nextForkSubnets = new Set();
  }

  start(): void {
    this.currentFork = this.chain.getForkName();
    this.chain.emitter.on(ChainEvent.forkVersion, this.handleForkVersion);
    this.run(this.currentFork);
    this.scheduleNextForkSubscription();
  }

  stop(): void {
    this.chain.emitter.off(ChainEvent.forkVersion, this.handleForkVersion);
    if (this.nextForkSubsTimer) {
      clearTimeout(this.nextForkSubsTimer);
    }

    for (const timer of this.nextForkTimers) {
      clearTimeout(timer);
    }

    this.cleanUpCurrentSubscriptions();
  }

  private run = (fork: ForkName): void => {
    for (let i = 0; i < this.config.params.RANDOM_SUBNETS_PER_VALIDATOR; i++) {
      this.subscribeToRandomSubnet(fork);
    }
  };

  /**
   * Prepare for EPOCHS_PER_RANDOM_SUBNET_SUBSCRIPTION epochs in advance of the fork
   */
  private scheduleNextForkSubscription = (): void => {
    // TODO figure out forking
    /*
    const state = this.chain.getHeadState();
    const currentForkVersion = state.fork.currentVersion;
    const nextFork = null as phase0.Fork;
    if (nextFork != null) {
      const preparedEpoch = nextFork.epoch - this.config.params.EPOCHS_PER_RANDOM_SUBNET_SUBSCRIPTION;
      const timeToPreparedEpoch =
        (computeStartSlotAtEpoch(this.config, preparedEpoch) - this.chain.clock.currentSlot) *
        this.config.params.SECONDS_PER_SLOT *
        1000;
      if (timeToPreparedEpoch > 0) {
        const nextForkDigest = computeForkDigest(this.config, nextFork.currentVersion, state.genesisValidatorsRoot);
        this.nextForkSubsTimer = setTimeout(() => {
          this.run(nextForkDigest);
        }, timeToPreparedEpoch);
      }
    }
    */
  };

  /**
   * Transition from current fork to next fork.
   */
  private handleForkVersion = (): void => {
    const fork = this.chain.getForkName();
    this.logger.important(`InteropSubnetsJoiningTask: received new fork ${fork}`);
    // at this time current fork digest and next fork digest subnets are subscribed in parallel
    // this cleans up current fork digest subnets subscription and keep subscribed to next fork digest subnets
    this.cleanUpCurrentSubscriptions();
    this.currentFork = fork;
    this.currentSubnets = this.nextForkSubnets;
    this.nextForkSubnets = new Set();
    this.currentTimers = this.nextForkTimers;
    this.nextForkTimers = [];
    this.scheduleNextForkSubscription();
  };

  /**
   * Clean up subscription and timers of current fork.
   */
  private cleanUpCurrentSubscriptions = (): void => {
    for (const timer of this.currentTimers) {
      clearTimeout(timer);
    }

    const attnets = this.network.metadata.attnets;

    for (const subnet of this.currentSubnets) {
      this.network.gossip.unsubscribeTopic({type: GossipType.beacon_attestation, fork: this.currentFork, subnet});
      attnets[subnet] = false;
    }

    this.network.metadata.attnets = attnets;
    this.currentSubnets.clear();
  };

  /**
   * Subscribe to a random subnet for a fork digest.
   * This can be either for the current fork or next fork.
   * @return choosen subnet
   */
  private subscribeToRandomSubnet(fork: ForkName): number {
    const subnet = randBetween(0, ATTESTATION_SUBNET_COUNT);
    this.network.gossip.subscribeTopic({type: GossipType.beacon_attestation, fork, subnet});
    const attnets = this.network.metadata.attnets;
    if (!attnets[subnet]) {
      attnets[subnet] = true;
      this.network.metadata.attnets = attnets;
    }
    const subscriptionLifetime = randBetween(
      this.config.params.EPOCHS_PER_RANDOM_SUBNET_SUBSCRIPTION,
      2 * this.config.params.EPOCHS_PER_RANDOM_SUBNET_SUBSCRIPTION
    );
    const timers = fork === this.currentFork ? this.currentTimers : this.nextForkTimers;
    timers.push(
      setTimeout(() => {
        this.handleChangeSubnets(fork, subnet);
      }, subscriptionLifetime * this.config.params.SLOTS_PER_EPOCH * this.config.params.SECONDS_PER_SLOT * 1000)
    );
    if (timers.length > this.config.params.RANDOM_SUBNETS_PER_VALIDATOR) {
      timers.shift();
    }
    const subnets = fork === this.currentFork ? this.currentSubnets : this.nextForkSubnets;
    subnets.add(subnet);
    return subnet;
  }

  private handleChangeSubnets = (fork: ForkName, subnet: number): void => {
    this.network.gossip.unsubscribeTopic({type: GossipType.beacon_attestation, fork, subnet});
    const attnets = this.network.metadata.attnets;
    if (attnets[subnet]) {
      attnets[subnet] = false;
      this.network.metadata.attnets = attnets;
    }
    const subnets = fork === this.currentFork ? this.currentSubnets : this.nextForkSubnets;
    subnets.delete(subnet);
    this.subscribeToRandomSubnet(fork);
  };

  private handleWireAttestation = (): void => {
    // ignore random committee attestations
  };
}
