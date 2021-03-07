/**
 * @module db/controller/impl
 */

import {LevelUp} from "levelup";
//@ts-ignore
import level from "level";
import pushable, {Pushable} from "it-pushable";
import all from "it-all";
import {ILogger} from "@chainsafe/lodestar-utils";
import {IDatabaseController, IDatabaseOptions, IFilterOptions, IKeyValue} from "../interface";

enum Status {
  started = "started",
  stopped = "stopped",
}

export interface ILevelDBOptions extends IDatabaseOptions {
  db?: LevelUp;
}

/**
 * The LevelDB implementation of DB
 */
export class LevelDbController implements IDatabaseController<Buffer, Buffer> {
  private status = Status.stopped;
  private db: LevelUp;

  private opts: ILevelDBOptions;

  private logger: ILogger;

  public constructor(opts: ILevelDBOptions, {logger}: {logger: ILogger}) {
    this.opts = opts;
    this.logger = logger;
    this.db = opts.db || level(opts.name || "beaconchain", {keyEncoding: "binary", valueEncoding: "binary"});
  }

  public async start(): Promise<void> {
    if (this.status === Status.started) return;
    this.status = Status.started;

    await this.db.open();
    this.logger.info("Connected to LevelDB database", {name: this.opts.name});
  }

  public async stop(): Promise<void> {
    if (this.status === Status.stopped) return;
    this.status = Status.stopped;

    await this.db.close();
  }

  public async clear(): Promise<void> {
    await this.db.clear();
  }

  public async get(key: Buffer): Promise<Buffer | null> {
    try {
      return await this.db.get(key);
    } catch (e) {
      if (e.notFound) {
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
    for (const item of items) batch.put(item.key, item.value);
    await batch.write();
  }

  public async batchDelete(keys: Buffer[]): Promise<void> {
    const batch = this.db.batch();
    for (const key of keys) batch.del(key);
    await batch.write();
  }

  public keysStream(opts?: IFilterOptions<Buffer>): Pushable<Buffer> {
    const source: Pushable<Buffer> = pushable();
    this.db
      .createKeyStream({...opts})
      .on("data", function (data) {
        source.push(data);
      })
      .on("close", function () {
        source.end();
      })
      .on("end", function () {
        source.end();
      });
    return source;
  }

  public async keys(opts?: IFilterOptions<Buffer>): Promise<Buffer[]> {
    return all(this.keysStream(opts));
  }

  public valuesStream(opts?: IFilterOptions<Buffer>): Pushable<Buffer> {
    const source: Pushable<Buffer> = pushable();
    this.db
      .createValueStream({...opts})
      .on("data", function (data) {
        source.push(data);
      })
      .on("close", function () {
        source.end();
      })
      .on("end", function () {
        source.end();
      });
    return source;
  }

  public async values(opts?: IFilterOptions<Buffer>): Promise<Buffer[]> {
    return all(this.valuesStream(opts));
  }

  public entriesStream(opts?: IFilterOptions<Buffer>): Pushable<IKeyValue<Buffer, Buffer>> {
    const source: Pushable<IKeyValue<Buffer, Buffer>> = pushable();
    this.db
      .createReadStream({...opts})
      .on("data", function (data) {
        source.push(data);
      })
      .on("close", function () {
        source.end();
      })
      .on("end", function () {
        source.end();
      });
    return source;
  }

  public async entries(opts?: IFilterOptions<Buffer>): Promise<IKeyValue<Buffer, Buffer>[]> {
    return all(this.entriesStream(opts));
  }
}
