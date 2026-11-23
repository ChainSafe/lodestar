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

/**
 * Trees of the devnet's keys with `publicParameters`, from a file of them at `url`: the record of
 * key `i` of the mnemonic is the `i`th. A key is found by its public parameter among the devnet's
 * public keys, which the trees are then checked against, so the file itself is not trusted. Any
 * other key has no trees here. The records are all read before this resolves.
 */
export async function devnetXmssTreeSource(
  url: string,
  publicParameters: Uint8Array[],
  logger: Pick<Logger, LogLevel.warn>
): Promise<XmssTreeSource> {
  const publicKeys = fs.readFileSync(DEVNET_PUBLIC_KEYS_PATH);
  const indexByParameter = new Map<string, number>();
  for (let index = 0; index < publicKeys.length / PUBLIC_KEY_SIZE; index++) {
    const end = (index + 1) * PUBLIC_KEY_SIZE;
    indexByParameter.set(toHex(publicKeys.subarray(end - PUBLIC_PARAMETER_SIZE, end)), index);
  }

  const found = new Map<string, {publicKey: Uint8Array; trees: Uint8Array}>();
  await Promise.all(
    publicParameters.map(async (publicParameter) => {
      const parameter = toHex(publicParameter);
      const index = indexByParameter.get(parameter);
      if (index === undefined) return;
      try {
        found.set(parameter, {
          publicKey: publicKeys.subarray(index * PUBLIC_KEY_SIZE, (index + 1) * PUBLIC_KEY_SIZE),
          trees: await readRecord(url, index),
        });
      } catch (e) {
        logger.warn("No leanXMSS trees from xmssCacheUrl: building them", {index}, e as Error);
      }
    })
  );

  return async (publicParameter) => found.get(toHex(publicParameter)) ?? null;
}

async function readRecord(url: string, index: number): Promise<Uint8Array> {
  const start = index * CACHE_RECORD_SIZE;
  let record: Uint8Array;
  if (isValidHttpUrl(url)) {
    record = await retry(
      async () => {
        const res = await fetch(url, {
          headers: {Range: `bytes=${start}-${start + CACHE_RECORD_SIZE - 1}`},
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });
        // 200 is the whole file: the server ignored the range
        if (res.status !== 206) {
          await res.body?.cancel();
          throw Error(`Range request failed with status ${res.status}`);
        }
        return new Uint8Array(await res.arrayBuffer());
      },
      {retries: FETCH_RETRIES, retryDelay: FETCH_RETRY_DELAY_MS, shouldRetry: isFetchError}
    );
  } else {
    const fd = fs.openSync(url.replace(/^file:\/\//, ""), "r");
    try {
      const buffer = Buffer.alloc(CACHE_RECORD_SIZE);
      record = buffer.subarray(0, fs.readSync(fd, buffer, 0, CACHE_RECORD_SIZE, start));
    } finally {
      fs.closeSync(fd);
    }
  }
  if (record.length !== CACHE_RECORD_SIZE) throw Error(`Record of ${record.length} bytes`);
  return record;
}
