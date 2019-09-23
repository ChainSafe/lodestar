/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * @module db/controller/impl
 */

// @ts-ignore
import PouchDB from "pouchdb-core";
// @ts-ignore
import MemoryAdapter from "pouchdb-adapter-memory";
import {IDatabaseController, ISearchOptions} from "../interface";
import {EventEmitter} from "events";
import {IDatabaseOptions} from "../../options";

PouchDB.plugin(MemoryAdapter);

const BASE_REVISION = "1";

export class PouchDbController extends EventEmitter implements IDatabaseController {

  private db: PouchDB.Database;

  public constructor(opts: IDatabaseOptions) {
    super();
    this.db = new PouchDB(
      opts.name || "lodestar-beaconchain",
      {
        adapter: "memory",
      }
    );
  }

  public async start(): Promise<void> {}

  public async stop(): Promise<void> {
    return this.db.close();
  }

  public clean(): Promise<void> {
    return this.db.destroy();
  }

  public async batchDelete(items: any[]): Promise<any> {
    const deletions: Buffer[] = [];
    //not really optimized,
    items.forEach(async item => {
      const doc = await this.db.get(item.toString("hex"));
      if(doc) {
        await this.db.remove(doc);
      }
    });
    //Search by key returns deleted documents, this line purges them completely
    await this.db.compact();
    return Promise.all(deletions);
  }

  public batchPut(items: { key: any; value: any }[]): Promise<any> {
    const additions: Buffer[] = [];
    //Tried with bulkDocs method but trowing some weird `Invalid rev format` error
    items.map((item) => {
      additions.push(
        this.put(item.key, item.value) as unknown as Buffer
      );
    });
    return Promise.all(additions);
  }

  public async get(key: any): Promise<Buffer | null> {
    if(typeof key !== "string") {
      key = key.toString("hex");
    }
    const result = await this.db.get(key);
    if(!result) return null;
    return  Buffer.from(result.value.data);
  }

  public put(key: any, value: any): Promise<any> {
    key = key.toString("hex");
    value = Buffer.from(value);
    return this.db.put({
      _id: key,
      value,
      _rev: BASE_REVISION
    }, {
      force: true
    });
  }

  public async search(opts: ISearchOptions): Promise<any[]> {
    const data = await this.db.allDocs({
      startkey: opts.gt.toString("hex"),
      endkey: opts.lt.toString("hex"),
      // eslint-disable-next-line camelcase,@typescript-eslint/camelcase
      include_docs: true,
      // eslint-disable-next-line camelcase,@typescript-eslint/camelcase
      inclusive_end: false
    });
    return data.rows.map((item: any) => Buffer.from(item.doc.value.data));
  }

  public async delete(key: any): Promise<void> {
    if(typeof key !== "string") {
      key = key.toString("hex");
    }
    await this.db.remove(key);
  }

}
