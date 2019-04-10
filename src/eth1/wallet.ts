import defaults from "./defaults";
import {ContractTransaction, ethers, Wallet} from "ethers";
import {Provider} from "ethers/providers";
import {number64} from "../types";
import {BigNumber} from "ethers/utils";

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
   * @param amount amount to wei to deposit on contract
   */
  public async createValidatorDeposit(address: string, amount: BigNumber): Promise<string> {
    const contract = new ethers.Contract(address, defaults.depositContract.abi, this.wallet);
    //TODO: Implement real deposit arguments according to spec : https://github.com/ethereum/eth2.0-specs/blob/dev/specs/core/0_beacon-chain.md#deposit-arguments
    const depositData = Buffer.alloc(512);
    const tx: ContractTransaction = await contract.deposit(depositData, {value: amount});
    await tx.wait();
    return tx.hash;
  }

}
