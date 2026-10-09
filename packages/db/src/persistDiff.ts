import {Id, Repository} from "./abstractRepository.js";
import {DbBatch} from "./controller/index.js";

/**
 * Persist target items `items` in `dbRepo` doing minimum put and delete writes.
 * Reads all keys in repository to compute the diff between current persisted data and target data.
 */
export async function persistDiff<K extends Id, V>(
  dbRepo: Repository<K, V>,
  items: {key: K; value: V}[],
  serializeKey: (key: K) => number | string,
  opts: {updateExisting?: boolean} = {}
): Promise<void> {
  const persistedKeys = await dbRepo.keys();
  const batch: DbBatch<K, V> = [];

  const persistedKeysSerialized = new Set(persistedKeys.map(serializeKey));
  for (const item of items) {
    if (opts.updateExisting || !persistedKeysSerialized.has(serializeKey(item.key))) {
      batch.push({type: "put", key: item.key, value: item.value});
    }
  }

  const targetKeysSerialized = new Set(items.map((item) => serializeKey(item.key)));
  for (const persistedKey of persistedKeys) {
    if (!targetKeysSerialized.has(serializeKey(persistedKey))) {
      batch.push({type: "del", key: persistedKey});
    }
  }

  if (batch.length > 0) await dbRepo.batch(batch);
}
