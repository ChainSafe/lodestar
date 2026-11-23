import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {LogLevel, Logger, fetch, isFetchError, isValidHttpUrl, retry, toHex} from "@lodestar/utils";
import {XmssTreeSource} from "@lodestar/validator";

/**
 * The leanXMSS public keys of the first 10000 keys of the pq devnet's mnemonic, 32 bytes each: the
 * first half of each record of ethereum-package's `static_files/xmss-keys/b9dec4e1daa17dfe.bin`.
 */
const DEVNET_PUBLIC_KEYS_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../pq-devnet-0-xmss-pubkeys.bin"
);
const PUBLIC_KEY_SIZE = 32;
const PUBLIC_PARAMETER_SIZE = 16;

/** A key's record in a file of tree caches: its top tree, then two bottom trees */
const CACHE_RECORD_SIZE = 4096 + 2 * 5300;
const FETCH_TIMEOUT_MS = 10_000;
const FETCH_RETRIES = 3;
const FETCH_RETRY_DELAY_MS = 1000;
const MAX_RECORDS_PER_REQUEST = 256;

type CacheLogger = Pick<Logger, LogLevel.debug | LogLevel.info | LogLevel.warn>;

/**
 * Trees of the devnet's keys with `publicParameters`, from a file of them at `url`: the record of
 * key `i` of the mnemonic is the `i`th. A key is found by its public parameter among the devnet's
 * public keys, which the trees are then checked against, so the file itself is not trusted. Any
 * other key has no trees here. The records are all read before this resolves, each run of
 * consecutive keys in one request.
 */
export async function devnetXmssTreeSource(
  url: string,
  publicParameters: Uint8Array[],
  logger: CacheLogger
): Promise<XmssTreeSource> {
  const publicKeys = fs.readFileSync(DEVNET_PUBLIC_KEYS_PATH);
  const indexByParameter = new Map<string, number>();
  for (let index = 0; index < publicKeys.length / PUBLIC_KEY_SIZE; index++) {
    const end = (index + 1) * PUBLIC_KEY_SIZE;
    indexByParameter.set(toHex(publicKeys.subarray(end - PUBLIC_PARAMETER_SIZE, end)), index);
  }

  const parameterByIndex = new Map<number, string>();
  for (const publicParameter of publicParameters) {
    const parameter = toHex(publicParameter);
    const index = indexByParameter.get(parameter);
    if (index !== undefined) parameterByIndex.set(index, parameter);
  }

  const found = new Map<string, {publicKey: Uint8Array; trees: Uint8Array}>();
  await Promise.all(
    recordRuns([...parameterByIndex.keys()]).map(async ({start, count}) => {
      try {
        const records = await readRecords(url, start, count, logger);
        for (let i = 0; i < count; i++) {
          const index = start + i;
          found.set(parameterByIndex.get(index) as string, {
            publicKey: publicKeys.subarray(index * PUBLIC_KEY_SIZE, (index + 1) * PUBLIC_KEY_SIZE),
            trees: records.subarray(i * CACHE_RECORD_SIZE, (i + 1) * CACHE_RECORD_SIZE),
          });
        }
      } catch (e) {
        logger.warn("No leanXMSS trees from xmssCacheUrl: building them", {start, count}, e as Error);
      }
    })
  );
  if (parameterByIndex.size > 0) {
    logger.info("Loaded leanXMSS trees from xmssCacheUrl", {loaded: found.size, requested: parameterByIndex.size});
  }

  return async (publicParameter) => found.get(toHex(publicParameter)) ?? null;
}

/** Runs of consecutive `indexes`, of at most `MAX_RECORDS_PER_REQUEST` each */
function recordRuns(indexes: number[]): {start: number; count: number}[] {
  const runs: {start: number; count: number}[] = [];
  for (const index of indexes.sort((a, b) => a - b)) {
    const last = runs.at(-1);
    if (last && index === last.start + last.count && last.count < MAX_RECORDS_PER_REQUEST) {
      last.count++;
    } else {
      runs.push({start: index, count: 1});
    }
  }
  return runs;
}

async function readRecords(url: string, start: number, count: number, logger: CacheLogger): Promise<Uint8Array> {
  const offset = start * CACHE_RECORD_SIZE;
  const size = count * CACHE_RECORD_SIZE;
  let records: Uint8Array;
  if (isValidHttpUrl(url)) {
    records = await retry(
      async () => {
        const res = await fetch(url, {
          headers: {Range: `bytes=${offset}-${offset + size - 1}`},
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });
        // 200 is the whole file: the server ignored the range
        if (res.status !== 206) {
          await res.body?.cancel();
          throw Error(`Range request failed with status ${res.status}`);
        }
        return new Uint8Array(await res.arrayBuffer());
      },
      {
        retries: FETCH_RETRIES,
        retryDelay: FETCH_RETRY_DELAY_MS,
        shouldRetry: isFetchError,
        onRetry: (e, attempt) => logger.debug("Retrying leanXMSS trees request", {start, count, attempt}, e),
      }
    );
  } else {
    const fd = fs.openSync(url.replace(/^file:\/\//, ""), "r");
    try {
      const buffer = Buffer.alloc(size);
      records = buffer.subarray(0, fs.readSync(fd, buffer, 0, size, offset));
    } finally {
      fs.closeSync(fd);
    }
  }
  if (records.length !== size) throw Error(`${count} records of ${records.length} bytes`);
  return records;
}
