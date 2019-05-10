/**
 * @module db
 */

import {DBOptions} from "../interface";

import PouchDB from "pouchdb-core";
import MemoryAdapter from "pouchdb-adapter-memory";
import AbstractDB, {SearchOptions} from "./abstract";

PouchDB.plugin(MemoryAdapter);

const BASE_REVISION = "1";

export class PouchDb extends AbstractDB {

  private db: PouchDB.Database;

  public constructor(opts: DBOptions) {
    super();
    this.db = new PouchDB(
      opts.name || 'lodestar-beaconchain',
      {
        adapter: 'memory',
      }
    );
  }

  public start(): Promise<void> {
    return null;
  }

  public stop(): Promise<void> {
    return this.db.close();
  }

  public clean(): Promise<void> {
    return this.db.destroy();
  }

  public async batchDelete(items: any[]): Promise<any> {
    const deletions = [];
    //not really optimized,
    items.forEach(async item => {
      const doc = await this.db.get(item.toString('hex'));
      if(doc) {
        await this.db.remove(doc);
      }
    });
    //Search by key returns deleted documents, this line purges them completely
    await this.db.compact();
    return Promise.all(deletions);
  }

  public batchPut(items: { key: any; value: any }[]): Promise<any> {
    const additions = [];
    //Tried with bulkDocs method but trowing some weird `Invalid rev format` error
    items.map((item) => {
      additions.push(
        this.put(item.key, item.value)
      );
    });
    return Promise.all(additions);
  }

  public async get(key: any): Promise<any> {
    key = key.toString('hex');
    return  Buffer.from((await this.db.get(key)).value.data);
  }

  public put(key: any, value: any): Promise<any> {
    key = key.toString('hex');
    return this.db.put({
      _id: key,
      value,
      _rev: BASE_REVISION
    }, {
      force: true
    });
  }

  public async search(opts: SearchOptions): Promise<any[]> {
    const data = await this.db.allDocs({
      startkey: opts.gt.toString('hex'),
      endkey: opts.lt.toString('hex'),
      // eslint-disable-next-line @typescript-eslint/camelcase
      include_docs: true,
      // eslint-disable-next-line @typescript-eslint/camelcase
      inclusive_end: false
    });
    return data.rows.map(item => Buffer.from(item.doc.value.data));
  }

}
