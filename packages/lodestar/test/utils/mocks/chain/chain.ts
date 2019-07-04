import {EventEmitter} from "events";

import {BeaconBlock, BeaconState, Deposit, Eth1Data, number64, Attestation, uint16, uint64} from "../../../../../types";
import {IBeaconChain, LMDGHOST} from "../../../../chain";

export class MockBeaconChain extends EventEmitter implements IBeaconChain {
  public genesisTime: number64;
  public forkChoice: LMDGHOST;
  public chainId: uint16;
  public networkId: uint64;

  public constructor({genesisTime, chainId, networkId}) {
    super();
    this.genesisTime = genesisTime;
    this.chainId = chainId;
    this.networkId = networkId;
  }

  public async start(): Promise<void> {}
  public async stop(): Promise<void> {}
  public async initializeChain(
    genesisTime: number64,
    genesisDeposits: Deposit[],
    genesisEth1Data: Eth1Data,
  ): Promise<void> {}
  public async receiveAttestation(attestation: Attestation): Promise<void> {}
  public async receiveBlock(block: BeaconBlock): Promise<void> {}
  public async applyForkChoiceRule(): Promise<void> {}
  public async isValidBlock(state: BeaconState, block: BeaconBlock): Promise<boolean> {
    return true;
  }
}
