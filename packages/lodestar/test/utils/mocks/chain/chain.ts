import {EventEmitter} from "events";

import {
  Attestation,
  BeaconBlock,
  BeaconState,
  Deposit,
  Eth1Data,
  Slot,
  Uint16,
  Uint64,
  SignedBeaconBlock,
  Root
} from "@chainsafe/eth2.0-types";
import {IBeaconChain, ILMDGHOST} from "../../../../src/chain";
import {generateState} from "../../state";
import { TreeBacked, List } from "@chainsafe/ssz";

export class MockBeaconChain extends EventEmitter implements IBeaconChain {
  public latestState: BeaconState;
  public forkChoice: ILMDGHOST;
  public chainId: Uint16;
  public networkId: Uint64;

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
  initializeBeaconChain(genesisState: BeaconState, depositDataRootList: TreeBacked<List<Root>>): Promise<void> {
    throw new Error("Method not implemented.");
  }
  isInitialized(): boolean {
    return !!this.latestState;
  }
}
