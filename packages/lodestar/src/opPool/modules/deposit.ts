import {Deposit, number64} from "@chainsafe/eth2.0-types";

import {DepositRepository} from "../../db/api/beacon/repositories";

export class DepositsOperations {

  protected readonly db: DepositRepository;

  public constructor(db: DepositRepository) {
    this.db = db;
  }

  public receive = async (index: number, value: Deposit): Promise<void> => {
    await this.db.set(index, value);
  };

  public async getAll(): Promise<Deposit[]> {
    return await this.db.getAll();
  }

  /**
   * Removes deposits with index <= depositCount - 1
   * @param depositCount
   */
  public async removeOld(depositCount: number64): Promise<void> {
    await this.db.deleteOld(depositCount);
  }

}
