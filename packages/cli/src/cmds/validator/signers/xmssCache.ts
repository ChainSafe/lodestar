import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {LogLevel, Logger, fetch, isFetchError, isValidHttpUrl, retry, toHex} from "@lodestar/utils";
import {XmssTrees} from "@lodestar/validator";

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
const FETCH_TIMEOUT_MS = 30_000;
/** Keys read in one request: megabytes, where every key of the devnet would be far more */
const MAX_RECORDS_PER_REQUEST = 256;

/**
 * Trees of the devnet's keys with `publicParameters`, by public parameter in hex, from a file of
 * them at `url`: the record of key `i` of the mnemonic is the `i`th. A key is found by its public
 * parameter among the devnet's public keys, which its trees are then checked against, so the file
 * itself is not trusted. Any other key has no trees here.
 *
 * Keys that follow one another in the mnemonic, as a validator client's do, are read at once.
 * This is to run before the keys are derived: that work fills the thread pool a request resolves
 * its host on, and a request made beside it waits past its timeout.
 */
export async function fetchDevnetXmssTrees(
  url: string,
  publicParameters: Uint8Array[],
  logger: Pick<Logger, LogLevel.warn>
): Promise<Map<string, XmssTrees>> {
  const publicKeys = fs.readFileSync(DEVNET_PUBLIC_KEYS_PATH);
  const indexByParameter = new Map<string, number>();
  for (let index = 0; index < publicKeys.length / PUBLIC_KEY_SIZE; index++) {
    const end = (index + 1) * PUBLIC_KEY_SIZE;
    indexByParameter.set(toHex(publicKeys.subarray(end - PUBLIC_PARAMETER_SIZE, end)), index);
  }

  const indices = publicParameters
    .map((publicParameter) => indexByParameter.get(toHex(publicParameter)))
    .filter((index) => index !== undefined)
    .sort((a, b) => a - b);

  const runs: {first: number; count: number}[] = [];
  for (const index of indices) {
    const last = runs.at(-1);
    if (last && index === last.first + last.count && last.count < MAX_RECORDS_PER_REQUEST) {
      last.count++;
    } else {
      runs.push({first: index, count: 1});
    }
  }

  const trees = new Map<string, XmssTrees>();
  await Promise.all(
    runs.map(async ({first, count}) => {
      try {
        const records = await readRecords(url, first, count);
        for (let index = first; index < first + count; index++) {
          const publicKey = publicKeys.subarray(index * PUBLIC_KEY_SIZE, (index + 1) * PUBLIC_KEY_SIZE);
          trees.set(toHex(publicKey.subarray(PUBLIC_KEY_SIZE - PUBLIC_PARAMETER_SIZE)), {
            publicKey,
            trees: records.subarray((index - first) * CACHE_RECORD_SIZE, (index - first + 1) * CACHE_RECORD_SIZE),
          });
        }
      } catch (e) {
        logger.warn("No leanXMSS trees from xmssCacheUrl: building them", {first, count}, e as Error);
      }
    })
  );
  return trees;
}

async function readRecords(url: string, first: number, count: number): Promise<Uint8Array> {
  const start = first * CACHE_RECORD_SIZE;
  const size = count * CACHE_RECORD_SIZE;
  let records: Uint8Array;
  if (isValidHttpUrl(url)) {
    // A request that fails is made again. A server that answers otherwise will again.
    records = await retry(
      async () => {
        const res = await fetch(url, {
          headers: {Range: `bytes=${start}-${start + size - 1}`},
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });
        // 200 is the whole file: the server ignored the range
        if (res.status !== 206) {
          await res.body?.cancel();
          throw Error(`Range request failed with status ${res.status}`);
        }
        return new Uint8Array(await res.arrayBuffer());
      },
      {retries: 3, retryDelay: 2000, shouldRetry: isFetchError}
    );
  } else {
    const fd = fs.openSync(url.replace(/^file:\/\//, ""), "r");
    try {
      const buffer = Buffer.alloc(size);
      records = buffer.subarray(0, fs.readSync(fd, buffer, 0, size, start));
    } finally {
      fs.closeSync(fd);
    }
  }
  if (records.length !== size) throw Error(`Read ${records.length} bytes of ${size}`);
  return records;
}
