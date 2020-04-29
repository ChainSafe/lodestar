import {ITask} from "../interface";
import {INetwork} from "../../network";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {ATTESTATION_SUBNET_COUNT} from "../../constants";
import {randBetween, ILogger} from "@chainsafe/lodestar-utils";
import {IBeaconChain} from "../../chain";
import {ForkDigest} from "@chainsafe/lodestar-types";
import {toHexString} from "@chainsafe/ssz";

export interface IInteropSubnetsJoiningModules {
  network: INetwork;
  chain: IBeaconChain;
  logger: ILogger;
}

export class InteropSubnetsJoiningTask implements ITask {

  private readonly config: IBeaconConfig;
  private readonly network: INetwork;
  private readonly chain: IBeaconChain;
  private readonly logger: ILogger;
  private subnets: Set<number>;
  private forkDigest: ForkDigest;

  private timers: (NodeJS.Timeout)[] = [];

  public constructor(config: IBeaconConfig, modules: IInteropSubnetsJoiningModules) {
    this.config = config;
    this.network = modules.network;
    this.chain = modules.chain;
    this.logger = modules.logger;
    this.subnets = new Set();
  }

  public async start(): Promise<void> {
    this.forkDigest = this.chain.currentForkDigest;
    this.chain.on("forkDigest", this.handleForkDigest);
    await this.run();
  }

  public async stop(): Promise<void> {
    this.chain.removeListener("forkDigest", this.handleForkDigest);
    return this.cleanUp();
  }

  public async run(): Promise<void> {
    for (let i = 0; i < this.config.params.RANDOM_SUBNETS_PER_VALIDATOR; i++) {
      this.subscribeToRandomSubnet(this.forkDigest);
    }
  }

  private handleForkDigest = async (forkDigest: ForkDigest): Promise<void> => {
    const forkDigestHash = toHexString(forkDigest).toLowerCase().substring(2);
    this.logger.important(`InteropSubnetsJoiningTask: received new fork digest ${forkDigestHash}`);
    await this.cleanUp();
    this.forkDigest = forkDigest;
    await this.run();
  };

  private async cleanUp(): Promise<void> {
    this.timers.forEach((timer) => clearTimeout(timer));
    this.subnets.forEach((subnet) => {
      this.network.gossip.unsubscribeFromAttestationSubnet(this.forkDigest, subnet, this.handleWireAttestation);
    });
    this.subnets.clear();
  }

  /**
     * @return choosen subnet
     */
  private subscribeToRandomSubnet(forkDigest: ForkDigest): number {
    const subnet = randBetween(0, ATTESTATION_SUBNET_COUNT);
    this.network.gossip.subscribeToAttestationSubnet(
      forkDigest,
      subnet,
      this.handleWireAttestation
    );
    const subscriptionLifetime = randBetween(
      this.config.params.EPOCHS_PER_RANDOM_SUBNET_SUBSCRIPTION,
      2 * this.config.params.EPOCHS_PER_RANDOM_SUBNET_SUBSCRIPTION,
    );
    this.timers.push(setTimeout(
      this.handleChangeSubnets,
      subscriptionLifetime
            * this.config.params.SLOTS_PER_EPOCH
            * this.config.params.SECONDS_PER_SLOT
            * 1000,
      forkDigest,
      subnet
    ) as unknown as NodeJS.Timeout);
    this.subnets.add(subnet);
    return subnet;
  }

  private handleChangeSubnets = async (forkDigest: ForkDigest, subnet: number): Promise<void> => {
    this.network.gossip.unsubscribeFromAttestationSubnet(forkDigest, subnet, this.handleWireAttestation);
    this.subnets.delete(subnet);
    this.subscribeToRandomSubnet(forkDigest);
  };

  private handleWireAttestation = (): void => {
    //ignore random committee attestations
  };

}