/**
 * @module db/controller
 */

import {EventEmitter} from "events";

export interface DBOptions {
  name?: string;
}

export interface SearchOptions {
  gt: any;
  lt: any;
}

export interface IDatabaseController extends EventEmitter{

  get(key: any): Promise<any>;

  batchPut(items: { key: any; value: any }[]): Promise<any>;

  batchDelete(items: any[]): Promise<any>;

  /**
   * Should return items which has key prefix >= opts.gt && prefix < opt.lt
   * @param opts
   */
  search(opts: SearchOptions): Promise<any[]>;

  /**
   * Should insert or update
   * @param key
   * @param value
   */
  put(key: any, value: any): Promise<any>;

  start(): Promise<void>;

  stop(): Promise<void>;

}
