import {EventEmitter} from "events";

import {
  Attestation,
  BeaconBlock,
  BeaconState,
  Deposit,
  Eth1Data,
  number64,
  uint16,
  uint64
} from "@chainsafe/eth2.0-types";
import {IBeaconChain, LMDGHOST} from "../../../../src/chain";
import {generateState} from "../../state";
import {ProgressiveMerkleTree} from "../../../../src/util/merkleTree";

export class MockBeaconChain extends EventEmitter implements IBeaconChain {
  public latestState: BeaconState;
  public forkChoice: LMDGHOST;
  public chainId: uint16;
  public networkId: uint64;

  public constructor({genesisTime, chainId, networkId}) {
    super();
    this.latestState = generateState({genesisTime});
    this.chainId = chainId;
    this.networkId = networkId;
  }

  public async start(): Promise<void> {}
  public async stop(): Promise<void> {}
  public async receiveAttestation(attestation: Attestation): Promise<void> {}
  public async receiveBlock(block: BeaconBlock): Promise<void> {}
  public async applyForkChoiceRule(): Promise<void> {}
  public async isValidBlock(state: BeaconState, block: BeaconBlock): Promise<boolean> {
    return true;
  }

  initializeBeaconChain(genesisState: BeaconState, merkleTree: ProgressiveMerkleTree): Promise<void> {
    throw new Error("Method not implemented.");
  }
  isInitialized(): boolean {
    return !!this.latestState;
  }
}
