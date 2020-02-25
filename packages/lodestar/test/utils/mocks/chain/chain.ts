import {EventEmitter} from "events";

import {
  Attestation,
  BeaconState,
  Slot,
  Number64,
  Uint16,
  Uint64,
  SignedBeaconBlock,
  Root
} from "@chainsafe/lodestar-types";
import {IBeaconChain, ILMDGHOST} from "../../../../src/chain";
import {generateState} from "../../state";
import {List, TreeBacked} from "@chainsafe/ssz";
import {IBeaconClock} from "../../../../src/chain/clock/interface";

export class MockBeaconChain extends EventEmitter implements IBeaconChain {
  public latestState: BeaconState;
  public forkChoice: ILMDGHOST;
  public chainId: Uint16;
  public networkId: Uint64;
  public clock: IBeaconClock;

  public constructor({genesisTime, chainId, networkId}: {genesisTime: Number64; chainId: Uint16; networkId: Uint64}) {
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
