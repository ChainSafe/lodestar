import {IBeaconChain} from "../../chain";
import {IBeaconDb} from "../../db";
import {IBeaconConfig, ForkName} from "@chainsafe/lodestar-config";
import {ATTESTATION_SUBNET_COUNT} from "@chainsafe/lodestar-params";
import {phase0} from "@chainsafe/lodestar-types";
import {INetwork} from "../../network";
import {ILogger} from "@chainsafe/lodestar-utils";
import {GossipHandlerFn, GossipType} from "../../network/gossip";

export interface IAttestationCollectorModules {
  chain: IBeaconChain;
  network: INetwork;
  db: IBeaconDb;
  logger: ILogger;
}

export class AttestationCollector {
  private readonly config: IBeaconConfig;
  private readonly chain: IBeaconChain;
  private readonly network: INetwork;
  private readonly db: IBeaconDb;
  private readonly logger: ILogger;
  private handlerFns: GossipHandlerFn[] = [];

  constructor(config: IBeaconConfig, modules: IAttestationCollectorModules) {
    this.config = config;
    this.chain = modules.chain;
    this.network = modules.network;
    this.db = modules.db;
    this.logger = modules.logger;
  }

  start(): void {
    if (this.handlerFns.length === 0) {
      for (let subnet = 0; subnet < ATTESTATION_SUBNET_COUNT; subnet++) {
        const wrapperFn = (async (attestation: phase0.Attestation): Promise<void> => {
          if (this.network.attService.shouldProcessAttestation(subnet, attestation.data.slot)) {
            await this.handleCommitteeAttestation(attestation);
          }
        }) as GossipHandlerFn;
        this.network.gossip.handleTopic(
          {type: GossipType.beacon_attestation, fork: ForkName.phase0, subnet},
          wrapperFn
        );
        this.handlerFns.push(wrapperFn);
      }
    }
  }

  stop(): void {
    for (let subnet = 0; subnet < ATTESTATION_SUBNET_COUNT; subnet++) {
      if (this.handlerFns[subnet]) {
        this.network.gossip.unhandleTopic(
          {type: GossipType.beacon_attestation, fork: ForkName.phase0, subnet},
          this.handlerFns[subnet]
        );
      }
    }
  }

  private handleCommitteeAttestation = async (attestation: phase0.Attestation): Promise<void> => {
    await this.db.attestation.add(attestation);
  };
}
