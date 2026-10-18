import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {LevelDb, type LevelDbIterator, type LevelDbOptions} from "../../src/leveldb.js";

export const bytes = (...values: number[]): Uint8Array => Uint8Array.from(values);

export async function withPath(run: (path: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "lodestar-leveldb-"));
  try {
    await run(join(directory, "db"));
  } finally {
    await rm(directory, {force: true, recursive: true});
  }
}

export async function withDatabase(
  run: (database: LevelDb, path: string) => Promise<void>,
  options?: LevelDbOptions
): Promise<void> {
  await withPath(async (path) => {
    const database = await LevelDb.open(path, options);
    try {
      await run(database, path);
    } finally {
      await database.close();
    }
  });
}

export async function collect<T>(iterator: LevelDbIterator<T>): Promise<T[]> {
  const entries: T[] = [];
  try {
    for (let count = 0; count < 16; count++) {
      const next = await iterator.next();
      if (next.done) return entries;
      entries.push(next.value);
    }
    throw new Error("Test iterator exceeded 16 entries");
  } finally {
    await iterator.close();
  }
}
