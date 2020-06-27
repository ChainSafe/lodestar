/**
 * @module db/controller/impl
 */

import PouchDB from "pouchdb-core";
import MemoryAdapter from "pouchdb-adapter-memory";
import {toHexString} from "@chainsafe/ssz";

import {IDatabaseController, IKeyValue, IFilterOptions} from "../interface";
import {IDatabaseOptions} from "../../options";

PouchDB.plugin(MemoryAdapter);

const BASE_REVISION = "1";

interface IPouchDocument {
  _id: string;
  _rev: string;
  value: {
    data: number[];
  };
}
interface IPouchResult {
  doc: IPouchDocument;
}

export class PouchDbController implements IDatabaseController<Buffer, Buffer> {

  private db: PouchDB.Database;

  public constructor(opts: IDatabaseOptions) {
    this.db = new PouchDB(
      opts.name || "lodestar-beaconchain",
      {
        adapter: "memory",
      }
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-empty-function
  public async start(): Promise<void> {}

  public async stop(): Promise<void> {
    return this.db.close();
  }

  public async get(key: Buffer): Promise<Buffer | null> {
    const result = await this._get(key);
    return result ? Buffer.from(result.value.data) : null;
  }

  public async _get(key: Buffer): Promise<IPouchDocument | null> {
    try {
      return await this.db.get(toHexString(key));
    } catch (e) {
      if (e.name === "not_found") {
        return null;
      } else {
        throw e;
      }
    }
  }

  public async put(key: Buffer, value: Buffer): Promise<void> {
    const existingDoc = await this._get(key);
    value = Buffer.from(value);
    return this.db.put({
      _id: toHexString(key),
      _rev: existingDoc ? existingDoc._rev : BASE_REVISION,
      value,
    }, {
      force: true
    });
  }

  public async delete(key: Buffer): Promise<void> {
    const existingDoc = await this._get(key);
    if (!existingDoc) {
      return null;
    }
    await this.db.remove(existingDoc._id, existingDoc._rev);
  }

  public async batchPut(items: IKeyValue<Buffer, Buffer>[]): Promise<void> {
    const additions: Promise<void>[] = [];
    //Tried with bulkDocs method but trowing some weird `Invalid rev format` error
    items.map((item) => {
      additions.push(
        this.put(item.key, item.value)
      );
    });
    return Promise.all(additions) as unknown as Promise<void>;
  }

  public async batchDelete(keys: Buffer[]): Promise<void> {
    //not really optimized,
    await Promise.all(keys.map(key => this.delete(key)));
    //Search by key returns deleted documents, this line purges them completely
    await this.db.compact();
  }

  public async keys(opts?: IFilterOptions<Buffer>): Promise<Buffer[]> {
    const data = await this.db.allDocs(this.toPouchOptions(opts));
    return data.rows.map((item: IPouchResult) => Buffer.from(item.doc._id));
  }

  public keysStream(opts?: IFilterOptions<Buffer>): AsyncIterable<Buffer> {
    const keys = this.keys;
    return async function * () {
      yield* await keys(opts);
    }();
  }

  public async values(opts?: IFilterOptions<Buffer>): Promise<Buffer[]> {
    const data = await this.db.allDocs(this.toPouchOptions(opts));
    return data.rows.map((item: IPouchResult) => Buffer.from(item.doc.value.data));
  }

  public valuesStream(opts?: IFilterOptions<Buffer>): AsyncIterable<Buffer> {
    const values = this.values;
    return async function * () {
      yield* await values(opts);
    }();
  }

  public async entries(opts?: IFilterOptions<Buffer>): Promise<IKeyValue<Buffer, Buffer>[]> {
    const data = await this.db.allDocs(this.toPouchOptions(opts));
    return data.rows.map((item: IPouchResult) => ({
      key: Buffer.from(item.doc._id),
      value: Buffer.from(item.doc.value.data),
    }));
  }

  public entriesStream(opts?: IFilterOptions<Buffer>): AsyncIterable<IKeyValue<Buffer, Buffer>> {
    const entries = this.entries;
    return async function * () {
      yield* await entries(opts);
    }();
  }

  private toPouchOptions(opts?: IFilterOptions<Buffer>): object {
    return {
      // eslint-disable-next-line camelcase,@typescript-eslint/camelcase
      include_docs: true,
      // eslint-disable-next-line camelcase,@typescript-eslint/camelcase
      inclusive_end: !(opts && opts.lt),
      descending: opts && opts.reverse,
      startkey: (opts && (opts.gt || opts.gte)) ? toHexString(opts.gt || opts.gte) : undefined,
      end: (opts && (opts.lt || opts.lte)) ? toHexString(opts.lt || opts.lte) : undefined,
    };
  }
}
