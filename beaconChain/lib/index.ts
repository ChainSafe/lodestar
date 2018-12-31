import { ChainStart } from "../interfaces/state";
import { waitForChainStart } from "./powChain";

/**
 * Start calls waitForChainStart, until the eth1depoist contract has executed the `ChainStart` log. Once executed, it
 * will generate the initial state ("genesis block").
 * @returns {Promise<void>}
 * @constructor
 */
  // TODO currently returns a promise due to async calls, probably a better way.
const Start = async (): Promise<void> => {
  // NOTE: It is not possible to catch in this implementation, the promise only resolves.
  const startConfig: ChainStart = await waitForChainStart();
  // Call getInitialBeaconState() and start the beacon chain.
  // const initialState = getInitialBeaconState();
  // TBD...
};

export default Start;
