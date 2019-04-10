import defaults from "./defaults";
import {ContractTransaction, ethers, Wallet} from "ethers";
import {Provider} from "ethers/providers";

export class Eth1Wallet {

  private wallet: Wallet;

  constructor(privateKey: string, provider?: Provider) {
      if(!provider) {
        provider = ethers.getDefaultProvider()
      }
      this.wallet = new Wallet(privateKey, provider);
  }

  /**
   * Will deposit 32 ETH to eth2.0 deposit contract.
   * @param address address of deposit contract
   */
  public async createValidatorDeposit(address: string): Promise<string> {
    const contract = new ethers.Contract(address, defaults.depositContract.abi, this.wallet.provider);
    contract.connect(this.wallet);
    //TODO: Implement real deposit arguments according to spec : https://github.com/ethereum/eth2.0-specs/blob/dev/specs/core/0_beacon-chain.md#deposit-arguments
    const depositData = Buffer.alloc(512);
    const tx: ContractTransaction = await contract.deposit(depositData, {value: ethers.utils.parseEther('32.0')});
    await tx.wait();
    return tx.hash;
  }

}
