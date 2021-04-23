import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {phase0} from "@chainsafe/lodestar-types";
import {IBeaconChain} from "../../chain";
import {Eth2Gossipsub} from "../gossip";
import {MetadataController} from "../metadata";

export interface IAttestationService {
  validatorSubscriptions(subscriptions: phase0.BeaconCommitteeSubscription[]): void;
  shouldProcessAttestation(subnet: number, slot: phase0.Slot): boolean;
  getActiveSubnets(): number[];
}

export interface IAttestationServiceModules {
  config: IBeaconConfig;
  chain: IBeaconChain;
  gossip: Eth2Gossipsub;
  metadata: MetadataController;
}
