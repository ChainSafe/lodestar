import PeerId from "peer-id";

/**
 * Wrapper on PeerId.createFromB58String that logs the actual peerIdStr if it's invalid.
 * Else it logs a non-helpful message
 *
 * ```bash
 * Error: Non-base58btc character
 *   at decode (/usr/app/node_modules/multiformats/cjs/vendor/base-x.js:125:11)
 *   at Decoder.decode [as baseDecode] (/usr/app/node_modules/multiformats/cjs/src/bases/base.js:90:34)
 *   at Decoder.decode (/usr/app/node_modules/multiformats/cjs/src/bases/base.js:37:19)
 *   at Codec.decode (/usr/app/node_modules/multiformats/cjs/src/bases/base.js:80:25)
 *   at Function.exports.createFromB58String (/usr/app/node_modules/@chainsafe/lodestar/node_modules/peer-id/src/index.js:286:44)
 * ```
 */
export function createFromB58String(peerIdStr: string): PeerId {
  try {
    return PeerId.createFromB58String(peerIdStr);
  } catch (e) {
    (e as Error).message = `Invalid PeerId str '${peerIdStr}': ${(e as Error).message}`;
    throw e;
  }
}
