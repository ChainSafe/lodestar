import {DBOptions} from "../interface";

import PouchDB from "pouchdb-core";
import MemoryAdapter from "pouchdb-adapter-memory";
import AbstractDB, {SearchOptions} from "./abstract";

PouchDB.plugin(MemoryAdapter);

const BASE_REVISION: string = "v1";

export class PouchDb extends AbstractDB {

    private db: PouchDB.Database;

    public constructor(opts: DBOptions) {
        super();
        this.db = new PouchDB(opts.name || 'lodestar-beaconchain', {adapter: 'memory'});
    }

    start(): Promise<void> {
        return null;
    }

    stop(): Promise<void> {
        return this.db.close();
    }

    clean(): Promise<void> {
        return this.db.destroy();
    }

    batchDelete(items: Array<any>): Promise<any> {
        const deletitions = [];
        items.forEach(item => deletitions.push(this.db.remove(item.toString('hex'), BASE_REVISION)));
        return Promise.all(deletitions);
    }

    batchPut(items: Array<{ key: any; value: any }>): Promise<any> {
        const additions = [];
        //Tried with bulkDocs method but trowing some weird `Invalid rev format` error
        items.map((item) => {
            additions.push(
                this.put(item.key, item.value)
            )
        });
        return Promise.all(additions);
    }

    async get(key: any): Promise<any> {
        key = key.toString('hex');
        return  Buffer.from((await this.db.get(key)).value.data);
    }

    put(key: any, value: any): Promise<any> {
        key = key.toString('hex');
        return this.db.put({
            _id: key,
            value,
            _rev: BASE_REVISION
        }, {
            force: true
        });
    }

    async search(opts: SearchOptions): Promise<Array<any>> {
        const data = await this.db.allDocs({
            startKey: opts.gt.toString('hex'),
            endKey: opts.lt.toString('hex'),
            include_docs: true
        });
        return data.rows.map(item => Buffer.from(item.doc.value.data));
    }

}
