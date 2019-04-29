import level from "level";
import {LevelUp} from "levelup";

import {DB, DBOptions} from "../interface";
import AbstractDB, {SearchOptions} from "./abstract";
import {Attestation} from "../../types";
import logger from "../../logger";

export interface LevelDBOptions extends DBOptions {
  db?: LevelUp;
}

/**
 * The LevelDB implementation of DB
 */
export class LevelDB extends AbstractDB implements DB {
  private db: LevelUp;

  private opts: LevelDBOptions;

  public constructor(opts: LevelDBOptions) {
    super();
    this.opts = opts;
    this.db =
      opts.db
      ||
      level(
        opts.name || 'beaconchain',
        {keyEncoding: 'binary', valueEncoding: 'binary'}
      );
  }

  public async start(): Promise<void> {
    await this.db.open();
    logger.info( `Connected to LevelDB database at ${this.opts.name}`);
  }

  public async stop(): Promise<void> {
    await this.db.close();
  }

  public get(key: any): Promise<any> {
    return this.db.get(key);
  }

  public put(key: any, value: any): Promise<any> {
    return this.db.put(key, value);
  }

  public async batchPut(items: { key: any; value: any }[]): Promise<any> {
    const batch = this.db.batch();
    items.forEach(item => batch.put(item.key, item.value));
    await batch.write();
  }

  public async batchDelete(items: any[]): Promise<any> {
    const batch = this.db.batch();
    items.forEach(item => batch.del(item));
    await batch.write();
  }

  public search(opts: SearchOptions): Promise<any> {
    return new Promise<Attestation[]>((resolve, reject) => {
      const searchData = [];
      this.db.createValueStream({
        gt: opts.gt,
        lt: opts.lt,
      }).on('data', function (data) {
        searchData.push(data);
      }).on('close', function () {
        resolve(searchData);
      }).on('end', function () {
        resolve(searchData);
      });
    });
  }
}
