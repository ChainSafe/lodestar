import {IGossipHandler} from "./interface";
import {GossipEvent} from "../../network/gossip/constants";
import {INetwork} from "../../network";
import {
  AttesterSlashing,
  ProposerSlashing,
  SignedAggregateAndProof,
  SignedBeaconBlock,
  SignedVoluntaryExit
} from "@chainsafe/lodestar-types";
import {IBeaconChain} from "../../chain";
import {OpPool} from "../../opPool";

export class BeaconGossipHandler implements IGossipHandler {
    
  private readonly chain: IBeaconChain;
  private readonly network: INetwork;
  private readonly opPool: OpPool;

  constructor(chain: IBeaconChain, network: INetwork, opPool: OpPool) {
    this.chain = chain;
    this.network = network;
    this.opPool = opPool;
  }

  public async start(): Promise<void> {
    this.network.gossip.subscribeToBlock(this.chain.currentForkDigest, this.onBlock);
    this.network.gossip.subscribeToAggregateAndProof(this.chain.currentForkDigest, this.onAggregatedAttestation);
    this.network.gossip.subscribeToAttesterSlashing(this.chain.currentForkDigest, this.onAttesterSlashing);
    this.network.gossip.subscribeToProposerSlashing(this.chain.currentForkDigest, this.onProposerSlashing);
    this.network.gossip.subscribeToVoluntaryExit(this.chain.currentForkDigest, this.onVoluntaryExit);
  }

  public async stop(): Promise<void> {
    this.network.gossip.unsubscribe(this.chain.currentForkDigest, GossipEvent.BLOCK, this.onBlock);
    this.network.gossip.unsubscribe(
      this.chain.currentForkDigest, GossipEvent.AGGREGATE_AND_PROOF, this.onAggregatedAttestation
    );
    this.network.gossip.unsubscribe(
      this.chain.currentForkDigest, GossipEvent.ATTESTER_SLASHING, this.onAttesterSlashing
    );
    this.network.gossip.unsubscribe(
      this.chain.currentForkDigest, GossipEvent.PROPOSER_SLASHING, this.onProposerSlashing
    );
    this.network.gossip.unsubscribe(this.chain.currentForkDigest, GossipEvent.VOLUNTARY_EXIT, this.onVoluntaryExit);
  }
  
  private onBlock = async (block: SignedBeaconBlock): Promise<void> => {
    await this.chain.receiveBlock(block);
  };

  private onAggregatedAttestation = async (aggregate: SignedAggregateAndProof): Promise<void> => {
    await this.chain.receiveAttestation(aggregate.message.aggregate);
  };

  private onAttesterSlashing = async (attesterSlashing: AttesterSlashing): Promise<void> => {
    await this.opPool.attesterSlashings.receive(attesterSlashing);
  };

  private onProposerSlashing = async (proposerSlashing: ProposerSlashing): Promise<void> => {
    await this.opPool.proposerSlashings.receive(proposerSlashing);
  };

  private onVoluntaryExit = async (exit: SignedVoluntaryExit): Promise<void> => {
    await this.opPool.voluntaryExits.receive(exit);
  };

}