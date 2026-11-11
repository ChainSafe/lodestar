import {DbReqOpts, encodeKey} from "@lodestar/db";
import {BLSPubkey, Root} from "@lodestar/types";
import {intToBytes, toPubkeyHex, toRootHex} from "@lodestar/utils";
import {Bucket, getBucketNameByValue} from "../../buckets.js";
import {LodestarValidatorDatabaseController} from "../../types.js";
import {isEqualRoot} from "../utils.js";

/**
 * The signing root each leaf of a leanXMSS key has signed. A leaf signs one message: a second
 * one exposes its one-time key, so whoever sees both signatures can sign at that leaf.
 */
export class XmssLeafService {
  private readonly bucket = Bucket.xmssLeafSigningRoot;
  private readonly dbReqOpts: DbReqOpts = {bucketId: getBucketNameByValue(this.bucket)};
  private readonly pending = new Map<string, Promise<void>>();

  constructor(private readonly db: LodestarValidatorDatabaseController) {}

  /** Records that `leafIndex` signs `signingRoot`, or throws if it signed anything else */
  async checkAndInsert(pubkey: BLSPubkey, leafIndex: number, signingRoot: Root): Promise<void> {
    // One at a time for a key, so that two messages for a leaf cannot both find it unused
    const pubkeyHex = toPubkeyHex(pubkey);
    const previous = this.pending.get(pubkeyHex) ?? Promise.resolve();
    const current = previous.then(() => this.checkAndInsertUnguarded(pubkey, leafIndex, signingRoot));
    const settled = current.catch(() => {});
    this.pending.set(pubkeyHex, settled);
    try {
      await current;
    } finally {
      if (this.pending.get(pubkeyHex) === settled) this.pending.delete(pubkeyHex);
    }
  }

  private async checkAndInsertUnguarded(pubkey: BLSPubkey, leafIndex: number, signingRoot: Root): Promise<void> {
    const key = encodeKey(this.bucket, Buffer.concat([pubkey, intToBytes(leafIndex, 4, "be")]));
    const signed = await this.db.get(key, this.dbReqOpts);
    if (signed === null) {
      await this.db.put(key, signingRoot, this.dbReqOpts);
    } else if (!isEqualRoot(signed, signingRoot)) {
      throw Error(`Refusing to sign ${toRootHex(signingRoot)} at leaf ${leafIndex}, which signed ${toRootHex(signed)}`);
    }
  }
}
