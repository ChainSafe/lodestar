import {BUCKET_LENGTH} from "@chainsafe/lodestar-db";

export const FORK_VERSION_STUB = Buffer.alloc(0, 8);
export const DB_PREFIX_LENGTH = BUCKET_LENGTH + FORK_VERSION_STUB.length;
