import { DEPOSIT_CONTRACT_ADDRESS } from "../constants/constants";
import { BeaconState } from "../interfaces/state";

interface BeaconNodeCtx {
  chain: string;
  state: BeaconState;
  powChainAddress: string;
}

class BeaconNode {
  public chain: string;
  public state: BeaconState;
  public powChainAddress: string;

  constructor(opts: BeaconNodeCtx) {
    this.chain = opts.chain ? opts.chain : "mainnet";
    this.state = opts.state ? opts.state : getInitialState(); // real
    this.powChainAddress = opts.powChainAddress ? opts.powChainAddress : DEPOSIT_CONTRACT_ADDRESS;
  }
}

export default BeaconNode;
