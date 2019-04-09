import {hashTreeRoot} from "@chainsafe/ssz";
import {ValidatorIndex, BeaconBlock, BeaconState} from "../src/types";
import RPCProvider from "./stubs";
import {blsSign} from "../src/stubs/bls";
import {getDomain, slotToEpoch} from "../src/chain/helpers/stateTransitionHelpers";
import {DOMAIN_RANDAO} from "./constants";

export default class BlockProcessingService {
  private validatorIndex: ValidatorIndex;
  private provider: RPCProvider;
  private logger: blgr;

  public constructor(index: ValidatorIndex, provider: RPCProvider, logger: blgr) {
    this.validatorIndex = index;
    this.provider = provider;
    this.logger = logger;
  }

  /**
   * Check if validator is a proposer
   * @returns {Promise<boolean>}
   */
  private async isProposer(): Promise<boolean> {
    let isValid = false;
    while (!isValid) {
      this.logger.info("Checking if validator is proposer...");
      isValid = await this.provider.isActiveValidator(this.validatorIndex);
    }
    thislogger.info("Validator is proposer!");
    return true;
  }

  /**
   * IFF a validator is selected construct a block to propose.
   * @returns {Promise<void>}
   */
  private async buildBlock() {
    let block: BeaconBlock;
    const slot = await this.provider.getCurrentSlot();
    const prevBlock = await this.provider.getCurrentBlock();
    const curState = await this.provider.getCurrentState();
    block.slot = slot;
    // Note: To calculate state_root, the validator should first run the state transition function on an unsigned block
    // containing a stub for the state_root. It is useful to be able to run a state transition function that does not
    // validate signatures or state root for this purpose.
    block.parentRoot = hashTreeRoot(prevBlock);
    block.stateRoot = hashTreeRoot(curState);
    const epoch = slotToEpoch(block.slot);
    block.randaoReveal = blsSign(
      validator.privkey,
      hashTreeRoot(epoch),
      getDomain(curState.fork, epoch, DOMAIN_RANDAO)
      )
  }

  /**
   * Main function to start block processing
   * @returns {Promise<void>}
   */
  public async start() {
    await this.isProposer();
    this.buildBlock();
  }
}
