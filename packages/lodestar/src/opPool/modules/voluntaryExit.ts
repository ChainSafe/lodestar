import {OperationsModule} from "./abstract";
import {VoluntaryExit} from "@chainsafe/eth2-types";

export class VoluntaryExitOperations extends OperationsModule {

  /**
   * Process incoming voluntary exit
   */
  public async receive(exit: VoluntaryExit): Promise<void> {
    await this.db.setVoluntaryExit(exit);
  }

  /**
   * Return all stored voluntary exits
   */
  public async getAll(): Promise<VoluntaryExit[]> {
    return await this.db.getVoluntaryExits();
  }

  public async remove(exits: VoluntaryExit[]): Promise<void> {
    await this.db.deleteVoluntaryExits(exits);
  }

}
