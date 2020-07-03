import {INetwork} from "../../network";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {ATTESTATION_SUBNET_COUNT} from "../../constants";
import {randBetween, ILogger, intToBytes} from "@chainsafe/lodestar-utils";
import {IBeaconChain} from "../../chain";
import {ForkDigest} from "@chainsafe/lodestar-types";
import {toHexString} from "@chainsafe/ssz";
import {getCurrentSlot, computeStartSlotAtEpoch, computeForkDigest} from "@chainsafe/lodestar-beacon-state-transition";

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
  private currentForkDigest: ForkDigest;

  private currentTimers: (NodeJS.Timeout)[] = [];
  private nextForkTimers: (NodeJS.Timeout)[] = [];
  private nextForkSubsTimer: NodeJS.Timeout;

  public constructor(config: IBeaconConfig, modules: IInteropSubnetsJoiningModules) {
    this.config = config;
    this.network = modules.network;
    this.chain = modules.chain;
    this.logger = modules.logger;
    this.currentSubnets = new Set();
    this.nextForkSubnets = new Set();
  }

  public async start(): Promise<void> {
    this.currentForkDigest = this.chain.currentForkDigest;
    this.chain.on("forkDigest", this.handleForkDigest);
    await this.run(this.currentForkDigest);
    await this.scheduleNextForkSubscription();
  }

  public async stop(): Promise<void> {
    this.chain.removeListener("forkDigest", this.handleForkDigest);
    if (this.nextForkSubsTimer) {
      clearTimeout(this.nextForkSubsTimer);
    }
    this.nextForkTimers.forEach(clearTimeout);
    return this.cleanUpCurrentSubscriptions();
  }

  private run = async (forkDigest: ForkDigest): Promise<void> => {
    for (let i = 0; i < this.config.params.RANDOM_SUBNETS_PER_VALIDATOR; i++) {
      this.subscribeToRandomSubnet(forkDigest);
    }
  };

  /**
   * Prepare for EPOCHS_PER_RANDOM_SUBNET_SUBSCRIPTION epochs in advance of the fork
   */
  private scheduleNextForkSubscription = async(): Promise <void> => {
    const {state} = await this.chain.getHeadStateContext();
    const currentForkVersion = state.fork.currentVersion;
    const nextFork = this.config.params.ALL_FORKS && this.config.params.ALL_FORKS.find(
      (fork) => this.config.types.Version.equals(currentForkVersion, intToBytes(fork.previousVersion, 4)));
    if (nextFork) {
      const preparedEpoch = nextFork.epoch - this.config.params.EPOCHS_PER_RANDOM_SUBNET_SUBSCRIPTION;
      const timeToPreparedEpoch =
      (computeStartSlotAtEpoch(this.config, preparedEpoch) - getCurrentSlot(this.config, state.genesisTime)) *
        this.config.params.SECONDS_PER_SLOT * 1000;
      if (timeToPreparedEpoch > 0) {
        const nextForkDigest =
          computeForkDigest(this.config, intToBytes(nextFork.currentVersion, 4), state.genesisValidatorsRoot);
        this.nextForkSubsTimer =
          setTimeout(this.run, timeToPreparedEpoch, nextForkDigest) as unknown as NodeJS.Timeout;
      }
    }
  };

  /**
   * Transition from current fork to next fork.
   */
  private handleForkDigest = async (forkDigest: ForkDigest): Promise<void> => {
    this.logger.important(`InteropSubnetsJoiningTask: received new fork digest ${toHexString(forkDigest)}`);
    // at this time current fork digest and next fork digest subnets are subscribed in parallel
    // this cleans up current fork digest subnets subscription and keep subscribed to next fork digest subnets
    await this.cleanUpCurrentSubscriptions();
    this.currentForkDigest = forkDigest;
    this.currentSubnets = this.nextForkSubnets;
    this.nextForkSubnets = new Set();
    this.currentTimers = this.nextForkTimers;
    this.nextForkTimers = [];
    await this.scheduleNextForkSubscription();
  };

  /**
   * Clean up subscription and timers of current fork.
   */
  private cleanUpCurrentSubscriptions = async (): Promise<void> => {
    this.currentTimers.forEach(clearTimeout);
    const attnets = this.network.metadata.attnets;
    this.currentSubnets.forEach((subnet) => {
      this.network.gossip.unsubscribeFromAttestationSubnet(this.currentForkDigest, subnet, this.handleWireAttestation);
      attnets[subnet] = false;
    });
    this.network.metadata.attnets = attnets;
    this.currentSubnets.clear();
  };

  /**
   * Subscribe to a random subnet for a fork digest.
   * This can be either for the current fork or next fork.
   * @return choosen subnet
   */
  private subscribeToRandomSubnet(forkDigest: ForkDigest): number {
    const subnet = randBetween(0, ATTESTATION_SUBNET_COUNT);
    this.network.gossip.subscribeToAttestationSubnet(
      forkDigest,
      subnet,
      this.handleWireAttestation
    );
    const attnets = this.network.metadata.attnets;
    if (!attnets[subnet]) {
      attnets[subnet] = true;
      this.network.metadata.attnets = attnets;
    }
    const subscriptionLifetime = randBetween(
      this.config.params.EPOCHS_PER_RANDOM_SUBNET_SUBSCRIPTION,
      2 * this.config.params.EPOCHS_PER_RANDOM_SUBNET_SUBSCRIPTION,
    );
    const timers = this.config.types.ForkDigest.equals(forkDigest, this.currentForkDigest)?
      this.currentTimers : this.nextForkTimers;
    timers.push(setTimeout(
      this.handleChangeSubnets,
      subscriptionLifetime
            * this.config.params.SLOTS_PER_EPOCH
            * this.config.params.SECONDS_PER_SLOT
            * 1000,
      forkDigest,
      subnet
    ) as unknown as NodeJS.Timeout);
    if (timers.length > this.config.params.RANDOM_SUBNETS_PER_VALIDATOR) {
      timers.shift();
    }
    const subnets = this.config.types.ForkDigest.equals(forkDigest, this.currentForkDigest)?
      this.currentSubnets : this.nextForkSubnets;
    subnets.add(subnet);
    return subnet;
  }

  private handleChangeSubnets = async (forkDigest: ForkDigest, subnet: number): Promise<void> => {
    this.network.gossip.unsubscribeFromAttestationSubnet(forkDigest, subnet, this.handleWireAttestation);
    const attnets = this.network.metadata.attnets;
    if (attnets[subnet]) {
      attnets[subnet] = false;
      this.network.metadata.attnets = attnets;
    }
    const subnets = this.config.types.ForkDigest.equals(forkDigest, this.currentForkDigest)?
      this.currentSubnets : this.nextForkSubnets;
    subnets.delete(subnet);
    this.subscribeToRandomSubnet(forkDigest);
  };

  private handleWireAttestation = (): void => {
    //ignore random committee attestations
  };

}
