import {OperationsModule} from "./abstract";
import {ProposerSlashing} from "../../types";

export class ProposerSlashingOperations extends OperationsModule {

  /**
   * Process incoming proposer slashing
   */
  public async receive(proposerSlashing: ProposerSlashing): Promise<void> {
    await this.db.setProposerSlashing(proposerSlashing);
  }

  /**
   * Return all stored proposer slashings
   */
  public async all(): Promise<ProposerSlashing[]> {
    return await this.db.getProposerSlashings();
  }

  public async remove(proposerSlashings: ProposerSlashing[]): Promise<void> {
    await this.db.deleteProposerSlashings(proposerSlashings);
  }

}
