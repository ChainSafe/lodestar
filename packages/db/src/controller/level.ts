/**
 * @module db/controller/impl
 */

import {LevelUp} from "levelup";
import level from "level";
import all from "it-all";
import {ILogger} from "@chainsafe/lodestar-utils";
import {IDatabaseController, IDatabaseOptions, IFilterOptions, IKeyValue} from "./interface.js";

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
export class LevelDbController implements IDatabaseController<Uint8Array, Uint8Array> {
  private status = Status.stopped;
  private db: LevelUp;

  private opts: ILevelDBOptions;

  private logger: ILogger;

  constructor(opts: ILevelDBOptions, {logger}: {logger: ILogger}) {
    this.opts = opts;
    this.logger = logger;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-assignment
    this.db = opts.db || level(opts.name || "beaconchain", {keyEncoding: "binary", valueEncoding: "binary"});
  }

  async start(): Promise<void> {
    if (this.status === Status.started) return;
    this.status = Status.started;

    await this.db.open();
    this.logger.info("Connected to LevelDB database", {name: this.opts.name});
  }

  async stop(): Promise<void> {
    if (this.status === Status.stopped) return;
    this.status = Status.stopped;

    await this.db.close();
  }

  async clear(): Promise<void> {
    await this.db.clear();
  }

  async get(key: Uint8Array): Promise<Uint8Array | null> {
    try {
      return (await this.db.get(key)) as Uint8Array | null;
    } catch (e) {
      if ((e as NotFoundError).notFound) {
        return null;
      }
      throw e;
    }
  }

  async put(key: Uint8Array, value: Uint8Array): Promise<void> {
    await this.db.put(key, value);
  }

  async delete(key: Uint8Array): Promise<void> {
    await this.db.del(key);
  }

  async batchPut(items: IKeyValue<Uint8Array, Uint8Array>[]): Promise<void> {
    const batch = this.db.batch();
    for (const item of items) batch.put(item.key, item.value);
    await batch.write();
  }

  async batchDelete(keys: Uint8Array[]): Promise<void> {
    const batch = this.db.batch();
    for (const key of keys) batch.del(key);
    await batch.write();
  }

  keysStream(opts?: IFilterOptions<Uint8Array>): AsyncGenerator<Uint8Array> {
    return this.iterator({keys: true, values: false}, (key) => key, opts);
  }

  valuesStream(opts?: IFilterOptions<Uint8Array>): AsyncGenerator<Uint8Array> {
    return this.iterator({keys: false, values: true}, (_key, value) => value, opts);
  }

  entriesStream(opts?: IFilterOptions<Uint8Array>): AsyncGenerator<IKeyValue<Uint8Array, Uint8Array>> {
    return this.iterator({keys: true, values: true}, (key, value) => ({key, value}), opts);
  }

  async keys(opts?: IFilterOptions<Uint8Array>): Promise<Uint8Array[]> {
    return all(this.keysStream(opts));
  }

  async values(opts?: IFilterOptions<Uint8Array>): Promise<Uint8Array[]> {
    return all(this.valuesStream(opts));
  }

  async entries(opts?: IFilterOptions<Uint8Array>): Promise<IKeyValue<Uint8Array, Uint8Array>[]> {
    return all(this.entriesStream(opts));
  }

  /**
   * Turn an abstract-leveldown iterator into an AsyncGenerator.
   * Replaces https://github.com/Level/iterator-stream
   *
   * How to use:
   * - Entries = { keys: true, values: true }
   * - Keys =    { keys: true, values: false }
   * - Values =  { keys: false, values: true }
   */
  private async *iterator<T>(
    keysOpts: StreamKeysOpts,
    getValue: (key: Uint8Array, value: Uint8Array) => T,
    opts?: IFilterOptions<Uint8Array>
  ): AsyncGenerator<T> {
    // Entries = { keys: true, values: true }
    // Keys =    { keys: true, values: false }
    // Values =  { keys: false, values: true }

    const iterator = this.db.iterator({
      ...opts,
      ...keysOpts,
      // TODO: Test if this is necessary. It's in https://github.com/Level/iterator-stream but may be stale
      limit: opts?.limit ?? -1,
    });

    try {
      while (true) {
        const [key, value] = await new Promise<[Uint8Array, Uint8Array]>((resolve, reject) => {
          iterator.next((err, key: Uint8Array, value: Uint8Array) => {
            if (err) reject(err);
            else resolve([key, value]);
          });
        });

        // Source code justification of why this condition implies the stream is done
        // https://github.com/Level/level-js/blob/e2253839a62fa969de50e9114279763228959d40/iterator.js#L123
        if (key === undefined && value === undefined) {
          return; // Done
        }

        yield getValue(key, value);
      }
    } finally {
      // TODO: Should we await here?
      await new Promise<void>((resolve, reject) => {
        iterator.end((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    }
  }
}

type StreamKeysOpts = {
  keys: boolean;
  values: boolean;
};

/** From https://www.npmjs.com/package/level */
type NotFoundError = {
  notFound: true;
  type: "NotFoundError";
};
