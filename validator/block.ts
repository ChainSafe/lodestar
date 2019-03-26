import {ValidatorIndex, BeaconBlock} from "../src/types";
import RPCProvider from "./stubs";

export default class BlockProcessingService {
  private index: ValidatorIndex;
  private provider: Provider;
  constructor(index: ValidatorIndex, provider: RPCProvider) {
    this.index = index;
    this.provider = provider
  }

  private async isProposer(): Promise<boolean> {
    let isValid: boolean = false;
    while (!isValid) {
      this.logger.info("Checking if validator is proposer...");
      isValid = await this.provider.isActiveValidator(this.validatorIndex);
    }
    this.logger.info("Validator is proposer!")
    return true;
  }

  private async buildBlock() {
    let block: BeaconBlock;
    const slot = await this.provider.getCurrentSlot();
    block.slot = slot;
    //todo finsihs
  }

  public async start() {
    await this.isProposer();
    this.buildBlock();
  }
}
