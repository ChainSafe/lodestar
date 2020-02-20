import {DepositData, Number64} from "@chainsafe/eth2.0-types";

import {DepositDataRepository} from "../../db/api/beacon/repositories";

export class DepositDataOperations {

  protected readonly db: DepositDataRepository;

  public constructor(db: DepositDataRepository) {
    this.db = db;
  }

  public receive = async (index: number, value: DepositData): Promise<void> => {
    await this.db.set(index, value);
  };

  public async getAll(): Promise<DepositData[]> {
    return await this.db.getAll();
  }


  /**
   * Limits are not inclusive
   * @param lowerLimit
   * @param upperLimit
   */
  public async getAllBetween(lowerLimit: number|null, upperLimit: number|null): Promise<DepositData[]> {
    return await this.db.getAllBetween(lowerLimit, upperLimit);
  }

  /**
   * Removes deposits with index <= depositCount - 1
   * @param depositCount
   */
  public async removeOld(depositCount: Number64): Promise<void> {
    await this.db.deleteOld(depositCount);
  }
}
