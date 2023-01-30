import fs from "node:fs";
import {ApiError, getClient} from "@lodestar/api";
import {config} from "@lodestar/config/default";
import {newZeroedArray} from "@lodestar/state-transition";
import {digest} from "@chainsafe/as-sha256";

// Script to analyze if a raw BLS pubkey bytes are sufficiently even distributed.
// If so, a shorter slice of the pubkey bytes can be used as key for the pubkey to index map.
//
// # How to use
// ```
// INFURA_ETH2_URL=https://someurl ../../node_modules/.bin/ts-node test/scripts/blsPubkeyBytesFrequency.ts collisions
// ```
// Available commands:
// - `frequency`
// - `collisions`
//
// # Results
// - byte pubkey[0] is not evenly distributed, since it includes some flags. Median frequency is 0.
// - bytes pubkey[1:5] are very evenly distributed.
//
// # Collisions rates
// (not hashed, byte offset = 1)
// bytes 1, collision rate 1
// bytes 2, collision rate 0.92230224609375
// bytes 3, collision rate 0.00013267993927001953
// bytes 4, collision rate 2.0954757928848267e-9
//
// (hashed)
// bytes 1, collision rate 1
// bytes 2, collision rate 0.92401123046875
// bytes 3, collision rate 0.00013625621795654297
// bytes 4, collision rate 3.026798367500305e-9

const filepath = "mainnet_pubkeys.csv";

async function run(): Promise<void> {
  // Cache locally to prevent re-fetch
  if (!fs.existsSync(filepath)) await writePubkeys();

  const pubkeys = fs.readFileSync(filepath, "utf8").trim().split("\n");

  switch (process.argv[2]) {
    case "frequency":
      return analyzeBytesFrequencies(pubkeys);

    case "collisions":
      return analyzeBytesCollisions(pubkeys);
  }
}

function analyzeBytesFrequencies(pubkeys: string[]): void {
  for (let i = 0; i < 5; i++) {
    const byte0Freq = newZeroedArray(256);

    for (const pubkeyStr of pubkeys) {
      const byte0 = parseInt(pubkeyStr.slice(i * 2, (i + 1) * 2), 16);
      byte0Freq[byte0] = 1 + (byte0Freq[byte0] ?? 0);
    }

    // eslint-disable-next-line no-console
    console.log(
      `Byte[${i}] frequency distribution`,
      JSON.stringify(
        byte0Freq.map((f) => (f * 255) / pubkeys.length),
        null,
        2
      )
    );
  }
}

function analyzeBytesCollisions(pubkeys: string[]): void {
  const offset = 1;
  const useHash = true;

  for (let i = 1; i <= 4; i++) {
    const keySet = new Set<string>();
    const collisions = new Map<string, number>();

    for (const pubkeyStr of pubkeys) {
      let key: string;
      if (useHash) {
        const pubkey = Buffer.from(pubkeyStr, "hex");
        const pubkeyHash = digest(pubkey);
        key = Buffer.from(pubkeyHash.slice(offset, offset + i)).toString("hex");
      } else {
        key = pubkeyStr.slice(offset * 2, (offset + i) * 2);
      }

      if (keySet.has(key)) {
        collisions.set(key, 1 + (collisions.get(key) ?? 0));
      } else {
        keySet.add(key);
      }
    }

    // eslint-disable-next-line no-console
    console.log(`bytes ${i}, collision rate ${collisions.size / 256 ** i}`);
  }
}

async function writePubkeys(): Promise<void> {
  const baseUrl = process.env.INFURA_ETH2_URL;
  if (!baseUrl) {
    throw Error(`
  Must run with INFURA_ETH2_URL ENV, where the URL has the format:

  https://\${INFURA_CREDENTIALS}@eth2-beacon-\${NETWORK}.infura.io
`);
  }

  const client = getClient({baseUrl}, {config});

  const res = await client.debug.getStateV2("finalized");
  ApiError.assert(res);

  const pubkeys = Array.from(res.response.data.validators).map((validator) =>
    Buffer.from(validator.pubkey as Uint8Array).toString("hex")
  );

  fs.writeFileSync("mainnet_pubkeys.csv", pubkeys.join("\n"));
}

run().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
