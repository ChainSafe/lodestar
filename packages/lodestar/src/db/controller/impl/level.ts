/**
 * @module db/controller/impl
 */

import {LevelUp} from "levelup";
import {IDatabaseController, SearchOptions} from "../interface";
import {Attestation} from "@chainsafe/eth2.0-types";
import {EventEmitter} from "events";
import level from "level";
import {ILogger} from "../../../logger";
import {IDatabaseOptions} from "../../options";

export interface LevelDBOptions extends IDatabaseOptions {
  db?: LevelUp;
}

/**
 * The LevelDB implementation of DB
 */
export class LevelDbController extends EventEmitter implements IDatabaseController {

  private db: LevelUp;

  private opts: LevelDBOptions;

  private logger: ILogger;

  public constructor(opts: LevelDBOptions, {logger}: {logger: ILogger}) {
    super();
    this.opts = opts;
    this.logger = logger;
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
    this.logger.info( `Connected to LevelDB database at ${this.opts.name}`);
  }

  public async stop(): Promise<void> {
    await this.db.close();
  }

  public async get(key: any): Promise<Buffer | null> {
    try {
      return await this.db.get(key);
    } catch (e) {
      if(e.notFound) {
        return null;
      }
      throw e;
    }
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

  public async delete(key: any): Promise<void> {
    await this.db.del(key);
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
