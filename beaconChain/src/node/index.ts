import BN from "bn.js";

import { DEPOSIT_CONTRACT_ADDRESS } from "../constants";
import {getInitialDeposits} from "../pow/fake";
import { getInitialBeaconState } from "../state";
import {BeaconState} from "../types";

interface BeaconNodeCtx {
  chain: string;
  state: BeaconState;
  powChainAddress: string;
}

class BeaconNode {
  public chain: string;
  public state: BeaconState;
  public powChainAddress: string;

  public constructor(opts: BeaconNodeCtx) {
    this.chain = opts.chain ? opts.chain : "mainnet";
    this.powChainAddress = opts.powChainAddress ? opts.powChainAddress : DEPOSIT_CONTRACT_ADDRESS;

    // TODO :: Replace stubbed functionality
    const initialDeposits = getInitialDeposits(); // Stubbed - uses fake data
    this.state = opts.state ? opts.state : getInitialBeaconState(initialDeposits.deposits, new BN(initialDeposits.genesisTime), initialDeposits.eth1Data);
  }
}

export default BeaconNode;
