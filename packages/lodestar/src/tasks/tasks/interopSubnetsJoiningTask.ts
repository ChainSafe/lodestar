import {ITask} from "../interface";
import {INetwork} from "../../network";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {ATTESTATION_SUBNET_COUNT} from "../../constants";
import {randBetween} from "@chainsafe/lodestar-utils";
import {IBeaconChain} from "../../chain";
import {ForkDigest} from "@chainsafe/lodestar-types";

export interface IInteropSubnetsJoiningModules {
  network: INetwork;
  chain: IBeaconChain;
}

export class InteropSubnetsJoiningTask implements ITask {

  private readonly config: IBeaconConfig;
  private readonly network: INetwork;
  private readonly chain: IBeaconChain;

  private timers: (NodeJS.Timeout)[] = [];

  public constructor(config: IBeaconConfig, modules: IInteropSubnetsJoiningModules) {
    this.config = config;
    this.network = modules.network;
    this.chain = modules.chain;
  }

  public async run(): Promise<void> {
    const forkDigest = this.chain.currentForkDigest;
    for (let i = 0; i < this.config.params.RANDOM_SUBNETS_PER_VALIDATOR; i++) {
      this.subscribeToRandomSubnet(forkDigest);
    }
  }

  public async stop(): Promise<void> {
    this.timers.forEach((timer) => clearTimeout(timer));
  }

  //TODO: handle cleanup and unsubscribing

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
    return subnet;
  }

  private handleChangeSubnets = async (forkDigest: ForkDigest, subnet: number): Promise<void> => {
    this.network.gossip.unsubscribeFromAttestationSubnet(forkDigest, subnet, this.handleWireAttestation);
    this.subscribeToRandomSubnet(forkDigest);
  };

  private handleWireAttestation = (): void => {
    //ignore random committee attestations
  };

}