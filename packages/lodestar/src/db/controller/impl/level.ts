/**
 * @module db/controller/impl
 */

import {LevelUp} from "levelup";
import {IDatabaseController, IFilterOptions, IKeyValue} from "../interface";
//@ts-ignore
import level from "level";
import {ILogger} from "@chainsafe/lodestar-utils/lib/logger";
import {IDatabaseOptions} from "../../options";
import pushable, {Pushable} from "it-pushable";

export interface ILevelDBOptions extends IDatabaseOptions {
  db?: LevelUp;
}

/**
 * The LevelDB implementation of DB
 */
export class LevelDbController implements IDatabaseController<Buffer, Buffer> {

  private db: LevelUp;

  private opts: ILevelDBOptions;

  private logger: ILogger;

  public constructor(opts: ILevelDBOptions, {logger}: {logger: ILogger}) {
    this.opts = opts;
    this.logger = logger;
    this.db =
      opts.db
      ||
      level(
        opts.name || "beaconchain",
        {keyEncoding: "binary", valueEncoding: "binary"}
      );
  }

  public async start(): Promise<void> {
    await this.db.open();
    this.logger.info( `Connected to LevelDB database at ${this.opts.name}`);
  }

  public async stop(): Promise<void> {
    await this.db.close();
  }

  public async get(key: Buffer): Promise<Buffer | null> {
    try {
      return await this.db.get(key);
    } catch (e) {
      if(e.notFound) {
        return null;
      }
      throw e;
    }
  }

  public async put(key: Buffer, value: Buffer): Promise<void> {
    await this.db.put(key, value);
  }

  public async delete(key: Buffer): Promise<void> {
    await this.db.del(key);
  }

  public async batchPut(items: IKeyValue<Buffer, Buffer>[]): Promise<void> {
    const batch = this.db.batch();
    items.forEach(item => batch.put(item.key, item.value));
    await batch.write();
  }

  public async batchDelete(keys: Buffer[]): Promise<void> {
    const batch = this.db.batch();
    keys.forEach(key => batch.del(key));
    await batch.write();
  }

  public keysStream(opts?: IFilterOptions<Buffer>): Pushable<Buffer> {
    const source: Pushable<Buffer> = pushable();
    this.db.createKeyStream(
      {...opts}
    ).on("data", function (data) {
      source.push(data);
    }).on("close", function () {
      source.end();
    }).on("end", function () {
      source.end();
    });
    return source;
  }

  public async keys(opts?: IFilterOptions<Buffer>): Promise<Buffer[]> {
    const keys: Buffer[] = [];
    for await (const key of this.keysStream(opts)) {
      keys.push(key);
    }
    return keys;
  }

  public valuesStream(opts?: IFilterOptions<Buffer>): Pushable<Buffer> {
    const source: Pushable<Buffer> = pushable();
    this.db.createValueStream(
      {...opts}
    ).on("data", function (data) {
      source.push(data);
    }).on("close", function () {
      source.end();
    }).on("end", function () {
      source.end();
    });
    return source;
  }

  public async values(opts?: IFilterOptions<Buffer>): Promise<Buffer[]> {
    const values: Buffer[] = [];
    for await (const value of this.valuesStream(opts)) {
      values.push(value);
    }
    return values;
  }

  public entriesStream(opts?: IFilterOptions<Buffer>): Pushable<IKeyValue<Buffer, Buffer>> {
    const source: Pushable<IKeyValue<Buffer, Buffer>> = pushable();
    this.db.createReadStream(
      {...opts}
    ).on("data", function (data) {
      source.push(data);
    }).on("close", function () {
      source.end();
    }).on("end", function () {
      source.end();
    });
    return source;
  }

  public async entries(opts?: IFilterOptions<Buffer>): Promise<IKeyValue<Buffer, Buffer>[]> {
    const entries: IKeyValue<Buffer, Buffer>[] = [];
    for await (const entry of this.entriesStream(opts)) {
      entries.push(entry);
    }
    return entries;
  }
}
