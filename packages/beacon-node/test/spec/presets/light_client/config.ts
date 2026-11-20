import {BlobScheduleEntry, ChainConfig, GasLimitScheduleEntry} from "@lodestar/config";
import {intToBytes} from "@lodestar/utils";

/**
 * Normalize a `config.yaml` from the spec test vectors into a `Partial<ChainConfig>`.
 *
 * Fork epochs are read as bigint and unscheduled forks use 2^64, which does not fit in a number.
 */
export function pickConfigForkValues(config: Partial<ChainConfig>): Partial<ChainConfig> {
  const forkConfig: Partial<ChainConfig> = {};
  for (const key of Object.keys(config) as (keyof ChainConfig)[]) {
    const value = config[key];
    if (key.endsWith("_FORK_EPOCH")) {
      // Overwrite 2^64 to Infinity for an unscheduled fork.
      if (typeof value === "bigint" && value > BigInt(Number.MAX_SAFE_INTEGER)) {
        forkConfig[key] = Infinity as never;
      } else {
        forkConfig[key] = Number(value) as never;
      }
    } else if (key.endsWith("_FORK_VERSION") && typeof value === "bigint") {
      forkConfig[key] = intToBytes(value, 4, "be") as never;
    } else if (key === "BLOB_SCHEDULE" && Array.isArray(value)) {
      forkConfig[key] = (value as BlobScheduleEntry[]).map((entry) => ({
        EPOCH: Number(entry.EPOCH),
        MAX_BLOBS_PER_BLOCK: Number(entry.MAX_BLOBS_PER_BLOCK),
      }));
    } else if (key === "GAS_LIMIT_SCHEDULE" && Array.isArray(value)) {
      forkConfig[key] = (value as GasLimitScheduleEntry[]).map((entry) => ({
        EPOCH: Number(entry.EPOCH),
        GAS_LIMIT: Number(entry.GAS_LIMIT),
      }));
    }
  }
  return forkConfig;
}
