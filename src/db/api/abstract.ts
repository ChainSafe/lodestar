import {IDatabasePersistance} from "../persistance";
import {Service} from "../../node";

export interface DatabaseApiOptions {
  persistance: IDatabasePersistance;
}

export abstract class DatabaseService implements Service{

  protected db: IDatabasePersistance;

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
