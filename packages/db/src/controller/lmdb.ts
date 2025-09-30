import {Logger} from "@lodestar/utils";
import {DatabaseController, DatabaseOptions, DbReqOpts, FilterOptions, KeyValue} from "./interface.ts";
import {LevelDbControllerMetrics} from "./metrics.ts";

export type LmdbControllerModules = {
  logger: Logger;
  metrics?: LevelDbControllerMetrics | null;
};

export class LmdbController implements DatabaseController<Uint8Array, Uint8Array> {
  static async create(options: DatabaseOptions, {metrics}: LmdbControllerModules): Promise<LmdbController> {
    return new LmdbController();
  }
  static async destroy(_location: string): Promise<void> {}
  close(): Promise<void> {
    throw new Error("Method not implemented.");
  }
  setMetrics(metrics: LevelDbControllerMetrics): void {
    throw new Error("Method not implemented.");
  }
  get(key: Uint8Array<ArrayBufferLike>, opts?: DbReqOpts): Promise<Uint8Array<ArrayBufferLike> | null> {
    throw new Error("Method not implemented.");
  }
  getMany(key: Uint8Array<ArrayBufferLike>[], opts?: DbReqOpts): Promise<(Uint8Array<ArrayBufferLike> | undefined)[]> {
    throw new Error("Method not implemented.");
  }
  put(key: Uint8Array<ArrayBufferLike>, value: Uint8Array<ArrayBufferLike>, opts?: DbReqOpts): Promise<void> {
    throw new Error("Method not implemented.");
  }
  delete(key: Uint8Array<ArrayBufferLike>, opts?: DbReqOpts): Promise<void> {
    throw new Error("Method not implemented.");
  }
  batchPut(
    items: KeyValue<Uint8Array<ArrayBufferLike>, Uint8Array<ArrayBufferLike>>[],
    opts?: DbReqOpts
  ): Promise<void> {
    throw new Error("Method not implemented.");
  }
  batchDelete(keys: Uint8Array<ArrayBufferLike>[], opts?: DbReqOpts): Promise<void> {
    throw new Error("Method not implemented.");
  }
  keysStream(
    opts?: FilterOptions<Uint8Array<ArrayBufferLike>> | undefined
  ): AsyncIterable<Uint8Array<ArrayBufferLike>> {
    throw new Error("Method not implemented.");
  }
  keys(opts?: FilterOptions<Uint8Array<ArrayBufferLike>> | undefined): Promise<Uint8Array<ArrayBufferLike>[]> {
    throw new Error("Method not implemented.");
  }
  valuesStream(
    opts?: FilterOptions<Uint8Array<ArrayBufferLike>> | undefined
  ): AsyncIterable<Uint8Array<ArrayBufferLike>> {
    throw new Error("Method not implemented.");
  }
  values(opts?: FilterOptions<Uint8Array<ArrayBufferLike>> | undefined): Promise<Uint8Array<ArrayBufferLike>[]> {
    throw new Error("Method not implemented.");
  }
  entriesStream(
    opts?: FilterOptions<Uint8Array<ArrayBufferLike>> | undefined
  ): AsyncIterable<KeyValue<Uint8Array<ArrayBufferLike>, Uint8Array<ArrayBufferLike>>> {
    throw new Error("Method not implemented.");
  }
  entries(
    opts?: FilterOptions<Uint8Array<ArrayBufferLike>> | undefined
  ): Promise<KeyValue<Uint8Array<ArrayBufferLike>, Uint8Array<ArrayBufferLike>>[]> {
    throw new Error("Method not implemented.");
  }
}
