import {ITask} from "../interface";
import {INetwork} from "../../network";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";
import {ATTESTATION_SUBNET_COUNT} from "../../constants";
import {randBetween} from "@chainsafe/eth2.0-utils";

export interface IInteropSubnetsJoiningModules {
  network: INetwork;
}

export class InteropSubnetsJoiningTask implements ITask {

  private readonly config: IBeaconConfig;
  private readonly network: INetwork;

  public constructor(config: IBeaconConfig, modules: IInteropSubnetsJoiningModules) {
    this.config = config;
    this.network = modules.network;
  }

  public async run(): Promise<void> {
    for (let i = 0; i < this.config.params.RANDOM_SUBNETS_PER_VALIDATOR; i++) {
      this.subscribeToRandomSubnet();
    }
  }

  //TODO: handle cleanup and unsubscribing

  /**
     * @return choosen subnet
     */
  private subscribeToRandomSubnet(): number {
    const subnet = randBetween(0, ATTESTATION_SUBNET_COUNT);
    this.network.gossip.subscribeToAttestationSubnet(
      subnet,
      this.handleWireAttestation
    );
    setTimeout(
      this.handleChangeSubnets,
      this.config.params.EPOCHS_PER_RANDOM_SUBNET_SUBSCRIPTION
            * this.config.params.SLOTS_PER_EPOCH
            * this.config.params.SECONDS_PER_SLOT
            * 1000,
      subnet
    );
    return subnet;
  }

  private handleChangeSubnets = (subnet: number): void => {
    this.network.gossip.unsubscribeFromAttestationSubnet(subnet, this.handleWireAttestation);
    this.subscribeToRandomSubnet();
  };

  private handleWireAttestation = (): void => {
    //ignore random committee attestations
  };

}