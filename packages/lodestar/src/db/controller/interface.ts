/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * @module db/controller
 */

import {EventEmitter} from "events";

export interface ISearchOptions {
  gt: any;
  lt: any;
}

export interface IDatabaseController extends EventEmitter{

  get(key: any): Promise<Buffer | null>;

  batchPut(items: { key: any; value: any }[]): Promise<any>;

  batchDelete(items: any[]): Promise<any>;

  /**
   * Should return items which has key prefix >= opts.gt && prefix < opt.lt
   * @param opts
   */
  search(opts: ISearchOptions): Promise<any[]>;

  /**
   * Should insert or update
   * @param key
   * @param value
   */
  put(key: any, value: any): Promise<any>;

  delete(key: any): Promise<void>;

  start(): Promise<void>;

  stop(): Promise<void>;

}
