import {type Database, open} from "lmdb";
import {Logger} from "@lodestar/utils";
import {DatabaseController, DatabaseOptions, DbReqOpts, FilterOptions, KeyValue} from "./interface.ts";
import {LevelDbControllerMetrics} from "./metrics.ts";

export type LmdbControllerModules = {
  logger: Logger;
  metrics?: LevelDbControllerMetrics | null;
};

const BUCKET_ID_UNKNOWN = "unknown";

export class LmdbController implements DatabaseController<Uint8Array, Uint8Array> {
  db: Database<Uint8Array, Uint8Array>;
  metrics: LevelDbControllerMetrics | null;

  constructor(path: string, metrics: LevelDbControllerMetrics | null) {
    this.db = open<Uint8Array, Uint8Array>({
      path,
      encoding: "binary",
    });
    this.metrics = metrics;
  }

  static async create(options: DatabaseOptions, {metrics}: LmdbControllerModules): Promise<LmdbController> {
    return new LmdbController(options.name, metrics ?? null);
  }
  static async destroy(_location: string): Promise<void> {}

  close(): Promise<void> {
    return this.db.close();
  }

  setMetrics(metrics: LevelDbControllerMetrics): void {
    if (this.metrics !== null) {
      throw Error("metrics can only be set once");
    }
    this.metrics = metrics;
  }

  get(key: Uint8Array, opts?: DbReqOpts): Promise<Uint8Array | null> {
    this.metrics?.dbReadReq.inc({bucket: opts?.bucketId ?? BUCKET_ID_UNKNOWN}, 1);
    this.metrics?.dbReadItems.inc({bucket: opts?.bucketId ?? BUCKET_ID_UNKNOWN}, 1);
    return Promise.resolve(this.db.get(key) ?? null);
  }

  getMany(keys: Uint8Array[], opts: DbReqOpts): Promise<(Uint8Array | undefined)[]> {
    this.metrics?.dbReadReq.inc({bucket: opts.bucketId ?? BUCKET_ID_UNKNOWN}, 1);
    this.metrics?.dbReadItems.inc({bucket: opts.bucketId ?? BUCKET_ID_UNKNOWN}, keys.length);
    return this.db.getMany(keys);
  }

  async put(key: Uint8Array, value: Uint8Array, opts?: DbReqOpts): Promise<void> {
    this.metrics?.dbWriteReq.inc({bucket: opts?.bucketId ?? BUCKET_ID_UNKNOWN}, 1);
    this.metrics?.dbWriteItems.inc({bucket: opts?.bucketId ?? BUCKET_ID_UNKNOWN}, 1);
    await this.db.put(key, value);
  }

  async delete(key: Uint8Array, opts?: DbReqOpts): Promise<void> {
    this.metrics?.dbWriteReq.inc({bucket: opts?.bucketId ?? BUCKET_ID_UNKNOWN}, 1);
    this.metrics?.dbWriteItems.inc({bucket: opts?.bucketId ?? BUCKET_ID_UNKNOWN}, 1);
    await this.db.remove(key);
  }

  async batchPut(items: KeyValue<Uint8Array, Uint8Array>[], opts?: DbReqOpts): Promise<void> {
    this.metrics?.dbWriteReq.inc({bucket: opts?.bucketId ?? BUCKET_ID_UNKNOWN}, 1);
    this.metrics?.dbWriteItems.inc({bucket: opts?.bucketId ?? BUCKET_ID_UNKNOWN}, items.length);
    await this.db.batch(() => {
      for (const {key, value} of items) {
        this.db.put(key, value);
      }
    });
  }

  async batchDelete(keys: Uint8Array[], opts?: DbReqOpts): Promise<void> {
    this.metrics?.dbWriteReq.inc({bucket: opts?.bucketId ?? BUCKET_ID_UNKNOWN}, 1);
    this.metrics?.dbWriteItems.inc({bucket: opts?.bucketId ?? BUCKET_ID_UNKNOWN}, keys.length);
    await this.db.batch(() => {
      for (const key of keys) {
        this.db.remove(key);
      }
    });
  }

  async *keysStream(opts?: FilterOptions<Uint8Array> | undefined): AsyncIterable<Uint8Array> {
    const keys = this.db
      .getKeys({
        start: opts?.gt ?? opts?.gte,
        end: opts?.lt ?? opts?.lte,
        reverse: opts?.reverse,
        limit: opts?.limit,
      })
      .filter((key) => {
        if (opts?.gt !== undefined && Buffer.compare(key, opts.gt) <= 0) {
          return false;
        }
        if (opts?.gte !== undefined && Buffer.compare(key, opts.gte) < 0) {
          return false;
        }
        if (opts?.lt !== undefined && Buffer.compare(key, opts.lt) >= 0) {
          return false;
        }
        if (opts?.lte !== undefined && Buffer.compare(key, opts.lte) > 0) {
          return false;
        }
        return true;
      });
    this.metrics?.dbReadReq.inc({bucket: opts?.bucketId ?? BUCKET_ID_UNKNOWN}, 1);
    let itemsRead = 0;
    for (const key of keys) {
      itemsRead++;
      yield key;
    }
    this.metrics?.dbReadItems.inc({bucket: opts?.bucketId ?? BUCKET_ID_UNKNOWN}, itemsRead);
  }

  keys(opts?: FilterOptions<Uint8Array> | undefined): Promise<Uint8Array[]> {
    const keys = this.db
      .getKeys({
        start: opts?.gt ?? opts?.gte,
        end: opts?.lt ?? opts?.lte,
        reverse: opts?.reverse,
        limit: opts?.limit,
      })
      .filter((key) => {
        if (opts?.gt !== undefined && Buffer.compare(key, opts.gt) <= 0) {
          return false;
        }
        if (opts?.gte !== undefined && Buffer.compare(key, opts.gte) < 0) {
          return false;
        }
        if (opts?.lt !== undefined && Buffer.compare(key, opts.lt) >= 0) {
          return false;
        }
        if (opts?.lte !== undefined && Buffer.compare(key, opts.lte) > 0) {
          return false;
        }
        return true;
      }).asArray;
    this.metrics?.dbReadReq.inc({bucket: opts?.bucketId ?? BUCKET_ID_UNKNOWN}, 1);
    this.metrics?.dbReadItems.inc({bucket: opts?.bucketId ?? BUCKET_ID_UNKNOWN}, keys.length);
    return Promise.resolve(keys);
  }

  async *valuesStream(opts?: FilterOptions<Uint8Array> | undefined): AsyncIterable<Uint8Array> {
    const values = this.db
      .getRange({
        start: opts?.gt ?? opts?.gte,
        end: opts?.lt ?? opts?.lte,
        reverse: opts?.reverse,
        limit: opts?.limit,
      })
      .filter(({key}) => {
        if (opts?.gt !== undefined && Buffer.compare(key, opts.gt) <= 0) {
          return false;
        }
        if (opts?.gte !== undefined && Buffer.compare(key, opts.gte) < 0) {
          return false;
        }
        if (opts?.lt !== undefined && Buffer.compare(key, opts.lt) >= 0) {
          return false;
        }
        if (opts?.lte !== undefined && Buffer.compare(key, opts.lte) > 0) {
          return false;
        }
        return true;
      });
    this.metrics?.dbReadReq.inc({bucket: opts?.bucketId ?? BUCKET_ID_UNKNOWN}, 1);
    let itemsRead = 0;
    for (const {value} of values) {
      itemsRead++;
      yield value;
    }
    this.metrics?.dbReadItems.inc({bucket: opts?.bucketId ?? BUCKET_ID_UNKNOWN}, itemsRead);
  }

  values(opts?: FilterOptions<Uint8Array> | undefined): Promise<Uint8Array[]> {
    const values = this.db
      .getRange({
        start: opts?.gt ?? opts?.gte,
        end: opts?.lt ?? opts?.lte,
        reverse: opts?.reverse,
        limit: opts?.limit,
      })
      .filter(({key}) => {
        if (opts?.gt !== undefined && Buffer.compare(key, opts.gt) <= 0) {
          return false;
        }
        if (opts?.gte !== undefined && Buffer.compare(key, opts.gte) < 0) {
          return false;
        }
        if (opts?.lt !== undefined && Buffer.compare(key, opts.lt) >= 0) {
          return false;
        }
        if (opts?.lte !== undefined && Buffer.compare(key, opts.lte) > 0) {
          return false;
        }
        return true;
      })
      .map(({value}) => value).asArray;
    this.metrics?.dbReadReq.inc({bucket: opts?.bucketId ?? BUCKET_ID_UNKNOWN}, 1);
    this.metrics?.dbReadItems.inc({bucket: opts?.bucketId ?? BUCKET_ID_UNKNOWN}, values.length);
    return Promise.resolve(values);
  }

  async *entriesStream(opts?: FilterOptions<Uint8Array> | undefined): AsyncIterable<KeyValue<Uint8Array, Uint8Array>> {
    const entries = this.db
      .getRange({
        start: opts?.gt ?? opts?.gte,
        end: opts?.lt ?? opts?.lte,
        reverse: opts?.reverse,
        limit: opts?.limit,
      })
      .filter(({key}) => {
        if (opts?.gt !== undefined && Buffer.compare(key, opts.gt) <= 0) {
          return false;
        }
        if (opts?.gte !== undefined && Buffer.compare(key, opts.gte) < 0) {
          return false;
        }
        if (opts?.lt !== undefined && Buffer.compare(key, opts.lt) >= 0) {
          return false;
        }
        if (opts?.lte !== undefined && Buffer.compare(key, opts.lte) > 0) {
          return false;
        }
        return true;
      });
    this.metrics?.dbReadReq.inc({bucket: opts?.bucketId ?? BUCKET_ID_UNKNOWN}, 1);
    let itemsRead = 0;
    for (const entry of entries) {
      itemsRead++;
      yield entry;
    }
    this.metrics?.dbReadItems.inc({bucket: opts?.bucketId ?? BUCKET_ID_UNKNOWN}, itemsRead);
  }

  entries(opts?: FilterOptions<Uint8Array> | undefined): Promise<KeyValue<Uint8Array, Uint8Array>[]> {
    const entries = this.db
      .getRange({
        start: opts?.gt ?? opts?.gte,
        end: opts?.lt ?? opts?.lte,
        reverse: opts?.reverse,
        limit: opts?.limit,
      })
      .filter(({key}) => {
        if (opts?.gt !== undefined && Buffer.compare(key, opts.gt) <= 0) {
          return false;
        }
        if (opts?.gte !== undefined && Buffer.compare(key, opts.gte) < 0) {
          return false;
        }
        if (opts?.lt !== undefined && Buffer.compare(key, opts.lt) >= 0) {
          return false;
        }
        if (opts?.lte !== undefined && Buffer.compare(key, opts.lte) > 0) {
          return false;
        }
        return true;
      }).asArray;
    this.metrics?.dbReadReq.inc({bucket: opts?.bucketId ?? BUCKET_ID_UNKNOWN}, 1);
    this.metrics?.dbReadItems.inc({bucket: opts?.bucketId ?? BUCKET_ID_UNKNOWN}, entries.length);
    return Promise.resolve(entries);
  }
}
