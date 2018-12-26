import pollPowChain from "./pow";
import { ChainStart } from "../interfaces/state";

/**
 * NOTE: Currently the workflow is to call `pollDepositContract` and let it run until the `chainStart` log is emitted.
 * Start() begins by going through the logs from the mainnet chain to generate the "genesis block". Once pollPowChain() returns
 * the chainStart config, 
 */
const Start = async (): Promise<void> => {
  // NOTE: It is not possible to catch in this implementation, the promise only resolves.
  const config: ChainStart = await pollPowChain();
};

export default Start;
