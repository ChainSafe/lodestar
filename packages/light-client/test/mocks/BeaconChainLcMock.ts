import {toHexString} from "@chainsafe/ssz";
import {BeaconStateAltair} from "@lodestar/state-transition";
import {altair, Root, ssz} from "@lodestar/types";
import {IBeaconChainLc} from "../utils/prepareUpdateNaive.js";

/**
 * Mock BeaconChainLc interface that returns the blockHeaders and states given at the constructor.
 * Throws for any unknown root
 */
export class BeaconChainLcMock implements IBeaconChainLc {
  private readonly blockHeaders = new Map<string, altair.LightClientHeader>();
  private readonly states = new Map<string, altair.BeaconState>();

  constructor(blockHeaders: altair.LightClientHeader[], states: altair.BeaconState[]) {
    for (const blockHeader of blockHeaders)
      this.blockHeaders.set(toHexString(ssz.altair.LightClientHeader.hashTreeRoot(blockHeader)), blockHeader);
    for (const state of states) this.states.set(toHexString(ssz.altair.BeaconState.hashTreeRoot(state)), state);
  }

  async getBlockHeaderByRoot(blockRoot: Root): Promise<altair.LightClientHeader> {
    const rootHex = toHexString(blockRoot);
    const blockHeader = this.blockHeaders.get(rootHex);
    if (!blockHeader) throw Error(`No blockHeader for ${rootHex}`);
    return blockHeader;
  }

  async getStateByRoot(stateRoot: Root): Promise<BeaconStateAltair> {
    const rootHex = toHexString(stateRoot);
    const state = this.states.get(rootHex);
    if (!state) throw Error(`No state for ${rootHex}`);
    return ssz.altair.BeaconState.toViewDU(state);
  }
}
