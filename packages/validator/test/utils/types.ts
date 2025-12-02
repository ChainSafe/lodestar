import {toHex} from "@lodestar/utils";

export const ZERO_HASH = Buffer.alloc(32, 0);
export const ZERO_HASH_HEX = toHex(ZERO_HASH);
