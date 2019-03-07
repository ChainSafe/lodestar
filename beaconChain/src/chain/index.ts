import {EventEmitter} from "events";
import { BeaconState, uint64, Deposit, Eth1Data } from "../types";

/**
 * The BeaconChain service deals with processing incoming blocks, advancing a state transition, and applying the fork choice rule to update the chain head
 */
export class BeaconChain extends EventEmitter {
  public chain: string;
  private db;
  private eth1;

  public constructor(opts, {db, eth1}) {
    super();
    this.chain = opts.chain;
    this.db = db;
    this.eth1 = eth1;
  }
  public async start() {
    const stateExists = true;
    if (stateExists) {
      // start processing blocks
    } else {
      // listen for eth1 ChainStart event
      // then start processing blocks
    }
  }
  public async stop() {}

  public initializeBeaconChain(genesisTime: uint64, deposits: Deposit[], eth1Data: Eth1Data): BeaconState {
    return {} as BeaconState;
  }
}
