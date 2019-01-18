/**
 * All properties are optional such we can declare defaults.
 */
interface BeaconNodeCtx {
  chain?: string;
}

class BeaconNode {
  opts: BeaconNodeCtx;
  constructor(opts: BeaconNodeCtx) {
    this.opts = opts;

    this.opts.chain = opts.chain ? opts.chain : "mainnet";
  }

}

export default BeaconNode;
