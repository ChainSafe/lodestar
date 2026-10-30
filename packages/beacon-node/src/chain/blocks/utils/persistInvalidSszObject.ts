import path from "node:path";
import {Logger, toRootHex} from "@lodestar/utils";
import {ensureDir, writeIfNotExist} from "../../../util/file.js";

/**
 * Persist an SSZ object to disk (under a dated subdir of `dir`) for forensic investigation.
 * Shared by the facade (invalid gossip/api objects) and the engine (invalid pre/post states on STF failure).
 */
export async function persistInvalidSszObject(
  dir: string,
  logger: Logger,
  prefix: string,
  bytes: Uint8Array,
  root: Uint8Array,
  logStr?: string
): Promise<void> {
  const now = new Date();
  // yyyy-MM-dd
  const dateStr = now.toISOString().split("T")[0];

  const dirpath = path.join(dir, dateStr);
  const filepath = path.join(dirpath, `${prefix}_${toRootHex(root)}.ssz`);

  await ensureDir(dirpath);

  // as of Feb 17 2022 there are a lot of duplicate files stored with different date suffixes
  // remove date suffixes in file name, and check duplicate to avoid redundant persistence
  await writeIfNotExist(filepath, bytes);

  logger.debug("Persisted SSZ object", {id: logStr, filepath});
}
