import {OperationsModule} from "./abstract";
import {Transfer} from "@chainsafe/eth2-types";

export class TransferOperations extends OperationsModule {

  /**
   * Process incoming transfer
   */
  public async receive(transfer: Transfer): Promise<void> {
    await this.db.setTransfer(transfer);
  }

  /**
   * Return all stored transfers
   */
  public async getAll(): Promise<Transfer[]> {
    return this.db.getTransfers();
  }

  public async remove(transfers: Transfer[]): Promise<void> {
    await this.db.deleteTransfers(transfers);
  }

}
