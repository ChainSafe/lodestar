import {IBeaconChain} from "../../chain";
import {IBeaconDb} from "../../db";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {Attestation, CommitteeIndex, Slot} from "@chainsafe/lodestar-types";
import {IService} from "../../node";
import {INetwork} from "../../network";
import {computeSubnetForSlot} from "@chainsafe/lodestar-beacon-state-transition";
import {ILogger} from "@chainsafe/lodestar-utils";

export interface IAttestationCollectorModules {
  chain: IBeaconChain;
  network: INetwork;
  db: IBeaconDb;
  logger: ILogger;
}

export class AttestationCollector implements IService {

  private readonly config: IBeaconConfig;
  private readonly chain: IBeaconChain;
  private readonly network: INetwork;
  private readonly db: IBeaconDb;
  private readonly logger: ILogger;
  private timers: (NodeJS.Timeout)[] = [];
  private aggregationDuties: Map<Slot, Set<CommitteeIndex>> = new Map();

  public constructor(config: IBeaconConfig, modules: IAttestationCollectorModules) {
    this.config = config;
    this.chain = modules.chain;
    this.network = modules.network;
    this.db = modules.db;
    this.logger = modules.logger;
  }

  public async start(): Promise<void> {
    this.chain.clock.onNewSlot(this.checkDuties);
  }

  public async stop(): Promise<void> {
    this.timers.forEach((timer) => clearTimeout(timer));
    this.chain.clock.unsubscribeFromNewSlot(this.checkDuties);
  }

  public async subscribeToCommitteeAttestations(slot: Slot, committeeIndex: CommitteeIndex): Promise<void> {
    const forkDigest = this.chain.currentForkDigest;
    const headState = await this.chain.getHeadState();
    const subnet = computeSubnetForSlot(this.config, headState, slot, committeeIndex);
    try {
      this.network.gossip.subscribeToAttestationSubnet(forkDigest, subnet);
      if(this.aggregationDuties.has(slot)) {
        this.aggregationDuties.get(slot).add(committeeIndex);
      } else {
        this.aggregationDuties.set(slot, new Set([committeeIndex]));
      }
    } catch (e) {
      this.logger.error("Unable to subscribe to attestation subnet", {subnet});
    }
  }

  private checkDuties = async (slot: Slot): Promise<void> => {
    const committees = this.aggregationDuties.get(slot) || new Set();
    const forkDigest = this.chain.currentForkDigest;
    const headState = await this.chain.getHeadState();
    this.timers = [];
    committees.forEach((committeeIndex) => {
      const subnet = computeSubnetForSlot(this.config, headState, slot, committeeIndex);
      this.network.gossip.subscribeToAttestationSubnet(
        forkDigest,
        subnet,
        this.handleCommitteeAttestation
      );
      this.timers.push(setTimeout(
        this.unsubscribeSubnet,
        this.config.params.SECONDS_PER_SLOT * 1000,
        subnet
      ) as unknown as NodeJS.Timeout);
    });
    this.aggregationDuties.delete(slot);
  };

  private unsubscribeSubnet = (subnet: number): void => {
    const forkDigest = this.chain.currentForkDigest;
    try {
      this.network.gossip.unsubscribeFromAttestationSubnet(forkDigest, subnet, this.handleCommitteeAttestation);
    } catch (e) {
      this.logger.error("Unable to unsubscribe to attestation subnet", {subnet});
    }
  };

  private handleCommitteeAttestation = async ({attestation}: {attestation: Attestation}): Promise<void> => {
    await this.db.attestation.add(attestation);
  };
}
