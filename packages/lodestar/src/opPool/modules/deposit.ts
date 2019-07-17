import {OperationsModule} from "./abstract";
import {Deposit, number64} from "@chainsafe/eth2-types";

export class DepositsOperations extends OperationsModule {

  public async receive(index: number, deposit: Deposit): Promise<void> {
    return await this.db.setDeposit(index, deposit);
  }

  public async getAll(): Promise<Deposit[]> {
    return await this.db.getDeposits();
  }

  /**
   * Removes deposits with index <= depositCount - 1
   * @param depositCount
   */
  public async removeOld(depositCount: number64): Promise<void> {
    await this.db.deleteDeposits(depositCount);
  }

}
