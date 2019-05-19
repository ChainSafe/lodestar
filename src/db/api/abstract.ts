import {IDatabaseController} from "../persistance";
import {Service} from "../../node";

export interface DatabaseApiOptions {
  persistance: IDatabaseController;
}

export abstract class DatabaseService implements Service{

  protected db: IDatabaseController;

  protected constructor(opts: DatabaseApiOptions) {
    this.db = opts.persistance;
  }

  public async start(): Promise<void> {
    await this.db.start();
  }

  public async stop(): Promise<void> {
    await this.db.stop();
  }

}
