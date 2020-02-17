import {EventEmitter} from "events";

import {
  Attestation,
  BeaconBlock,
  BeaconState,
  Deposit,
  Eth1Data,
  number64, Slot,
  uint16,
  uint64,
  SignedBeaconBlock
} from "@chainsafe/eth2.0-types";
import {IBeaconChain, ILMDGHOST} from "../../../../src/chain";
import {generateState} from "../../state";
import {ProgressiveMerkleTree} from "@chainsafe/eth2.0-utils";
import {IBeaconClock} from "../../../../src/chain/clock/interface";

export class MockBeaconChain extends EventEmitter implements IBeaconChain {
  public latestState: BeaconState;
  public forkChoice: ILMDGHOST;
  public chainId: uint16;
  public clock: IBeaconClock;
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
  public async receiveBlock(signedBlock: SignedBeaconBlock): Promise<void> {}
  public async applyForkChoiceRule(): Promise<void> {}
  public async isValidBlock(state: BeaconState, block: SignedBeaconBlock): Promise<boolean> {
    return true;
  }
  public async advanceState(slot?: Slot): Promise<void>{}
  initializeBeaconChain(genesisState: BeaconState, merkleTree: ProgressiveMerkleTree): Promise<void> {
    throw new Error("Method not implemented.");
  }
  isInitialized(): boolean {
    return !!this.latestState;
  }
}
