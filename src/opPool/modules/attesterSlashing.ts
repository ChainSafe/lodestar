import {OperationsModule} from "./abstract";
import {AttesterSlashing} from "../../types";

export class AttesterSlashingOperations extends OperationsModule {

  /**
   * Process incoming attester slashing
   */
  public async receive(attesterSlashing: AttesterSlashing): Promise<void> {
    await this.db.setAttesterSlashing(attesterSlashing);
  }

  /**
   * Return all stored attester slashings
   */
  public async all(): Promise<AttesterSlashing[]> {
    return await this.db.getAttesterSlashings();
  }

  public async remove(attesterSlashings: AttesterSlashing[]): Promise<void> {
    await this.db.deleteAttesterSlashings(attesterSlashings);
  }

}
