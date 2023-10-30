import {fromHexString, toHexString} from "@chainsafe/ssz";
import {CachedBeaconStateAllForks} from "@lodestar/state-transition";
import {IBeaconDb} from "../../../db/interface.js";
import {CPStatePersistentApis, PersistentKey} from "./types.js";

/**
 * Implementation of CPStatePersistentApis using db.
 */
export class DbPersistentApis implements CPStatePersistentApis {
  constructor(private readonly db: IBeaconDb) {}

  async write(_: string, state: CachedBeaconStateAllForks): Promise<string> {
    const root = state.hashTreeRoot();
    const stateBytes = state.serialize();
    await this.db.checkpointState.putBinary(root, stateBytes);
    return toHexString(root);
  }

  async remove(persistentKey: PersistentKey): Promise<boolean> {
    await this.db.checkpointState.delete(fromHexString(persistentKey));
    return true;
  }

  async read(persistentKey: string): Promise<Uint8Array | null> {
    return this.db.checkpointState.getBinary(fromHexString(persistentKey));
  }

  /**
   * Clean all checkpoint state in db at startup time.
   */
  async init(): Promise<void> {
    const keys = await this.db.checkpointState.keys();
    await this.db.checkpointState.batchDelete(keys);
  }
}
