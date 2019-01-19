/**
 * All properties are optional such we can declare defaults.
 */
import {BeaconState} from "../interfaces/state";
import {DEPOSIT_CONTRACT_ADDRESS} from "../constants/constants";

interface BeaconNodeCtx {
  chain?: string;
  state?: BeaconState;
  powChainAddress?: string;
}

class BeaconNode {
  chain?: string;
  state?: BeaconState;
  powChainAddress?: string;

  constructor(opts: BeaconNodeCtx) {
    this.chain = opts.chain ? opts.chain : "mainnet";
    // Stubbed waititng for #73
    // this.state = opts.state ? opts.state : getInitialState(); // real
    this.state = opts.state ? opts.state : null; // not real
    this.powChainAddress = opts.powChainAddress ? opts.powChainAddress : DEPOSIT_CONTRACT_ADDRESS;
  }

  // Register all services
  public start = () => {

  }

  // Stop all services
  public stop = () => {

  }
}

export default BeaconNode;
