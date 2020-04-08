import {IBeaconChain} from "../../chain";
import {OpPool} from "../../opPool";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {Attestation, CommitteeIndex, Slot} from "@chainsafe/lodestar-types";
import {IService} from "../../node";
import {INetwork} from "../../network";
import {getCommitteeIndexSubnet} from "../../network/gossip/utils";

export interface IAttestationCollectorModules {
  chain: IBeaconChain;
  network: INetwork;
  opPool: OpPool;
}

export class AttestationCollector implements IService {

  private readonly config: IBeaconConfig;
  private readonly chain: IBeaconChain;
  private readonly network: INetwork;
  private readonly opPool: OpPool;

  private aggregationDuties: Map<Slot, Set<CommitteeIndex>> = new Map();

  public constructor(config: IBeaconConfig, modules: IAttestationCollectorModules) {
    this.config = config;
    this.chain = modules.chain;
    this.network = modules.network;
    this.opPool = modules.opPool;
  }

  public async start(): Promise<void> {
    this.chain.clock.onNewSlot(this.checkDuties);
  }

  // eslint-disable-next-line @typescript-eslint/no-empty-function
  public async stop(): Promise<void> {
  }

  public subscribeToCommitteeAttestations(slot: Slot, committeeIndex: CommitteeIndex): void {
    const forkDigest = this.chain.currentForkDigest;
    this.network.gossip.subscribeToAttestationSubnet(forkDigest, getCommitteeIndexSubnet(committeeIndex));
    if(this.aggregationDuties.has(slot)) {
      this.aggregationDuties.get(slot).add(committeeIndex);
    } else {
      this.aggregationDuties.set(slot, new Set([committeeIndex]));
    }
  }

  private checkDuties = (slot: Slot): void => {
    const committees = this.aggregationDuties.get(slot) || new Set();
    const forkDigest = this.chain.currentForkDigest;
    committees.forEach((committeeIndex) => {
      this.network.gossip.subscribeToAttestationSubnet(
        forkDigest,
        getCommitteeIndexSubnet(committeeIndex),
        this.handleCommitteeAttestation
      );
      setTimeout(
        this.unsubscribeSubnet,
        this.config.params.SECONDS_PER_SLOT * 1000,
        getCommitteeIndexSubnet(committeeIndex)
      );
    });
    this.aggregationDuties.delete(slot);
  };

  private unsubscribeSubnet = (subnet: number): void => {
    const forkDigest = this.chain.currentForkDigest;
    this.network.gossip.unsubscribeFromAttestationSubnet(forkDigest, subnet, this.handleCommitteeAttestation);
  };

  private handleCommitteeAttestation = async ({attestation}: {attestation: Attestation}): Promise<void> => {
    await this.opPool.attestations.receive(attestation);
  };
}