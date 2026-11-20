import {createHash} from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {Logger} from "@lodestar/utils";
import {JournalIdentity} from "./commitmentJournal.js";
import {ProposerPreferencesTracker} from "./proposerPreferencesTracker.js";

const MAX_BYTES = 256 * 1024;
const MAX_ENTRIES = 2 * SLOTS_PER_EPOCH * 4;

/** Optional cache of preferences already validated by our trusted beacon. Exact slot/dependent-root
 * lookup still decides eligibility. One writer and one replaceable pending snapshot bound disk work;
 * cache failure must never disable bid retention or overwrite the last complete snapshot. */
export class ProposerPreferencesCache {
  private pending: string | null = null;
  private running: Promise<void> | null = null;
  private persisted: string | null = null;
  private closed = false;

  constructor(
    private readonly filename: string,
    private readonly identity: JournalIdentity,
    private readonly logger: Logger
  ) {}

  async load(tracker: ProposerPreferencesTracker, currentSlot: number): Promise<number> {
    try {
      const info = await fs.lstat(this.filename);
      if (!info.isFile() || info.size > MAX_BYTES) throw Error("PROPOSER_PREFERENCES_CACHE_INVALID");
      const file = await fs.open(this.filename, "r");
      let text: string;
      try {
        const buffer = Buffer.alloc(MAX_BYTES + 1);
        let length = 0;
        while (length < buffer.length) {
          const {bytesRead} = await file.read(buffer, length, buffer.length - length, null);
          if (bytesRead === 0) break;
          length += bytesRead;
        }
        if (length > MAX_BYTES) throw Error("PROPOSER_PREFERENCES_CACHE_INVALID");
        text = buffer.toString("utf8", 0, length);
      } finally {
        await file.close();
      }
      const {data, checksum} = JSON.parse(text);
      if (
        checksum !== digest(JSON.stringify(data)) ||
        data.version !== 1 ||
        data.identity?.genesisValidatorsRoot !== this.identity.genesisValidatorsRoot ||
        data.identity?.pubkey !== this.identity.pubkey ||
        !Array.isArray(data.preferences) ||
        data.preferences.length > MAX_ENTRIES
      )
        throw Error("PROPOSER_PREFERENCES_CACHE_INVALID");
      // Parse the whole snapshot before admitting any entry from a corrupt cache.
      const decoded = data.preferences.map((entry: unknown) => ssz.gloas.SignedProposerPreferences.fromJson(entry));
      const restored = new ProposerPreferencesTracker();
      for (const signed of decoded) restored.onProposerPreferences(signed);
      let added = 0;
      for (const signed of restored.snapshot(currentSlot)) if (tracker.onProposerPreferences(signed)) added++;
      return added;
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
        this.logger.warn("Unable to restore proposer preferences cache", {}, error as Error);
      return 0;
    }
  }

  save(tracker: ProposerPreferencesTracker, currentSlot: number): Promise<void> {
    if (this.closed) return this.running ?? Promise.resolve();
    try {
      const data = {
        version: 1,
        identity: this.identity,
        preferences: tracker.snapshot(currentSlot).map((signed) => ssz.gloas.SignedProposerPreferences.toJson(signed)),
      };
      const text = JSON.stringify({data, checksum: digest(JSON.stringify(data))});
      if (Buffer.byteLength(text) > MAX_BYTES) throw Error("PROPOSER_PREFERENCES_CACHE_LIMIT");
      this.pending = text;
      this.running ??= this.flush();
      return this.running;
    } catch (error) {
      this.logger.warn("Unable to persist proposer preferences cache", {}, error as Error);
      return this.running ?? Promise.resolve();
    }
  }

  async close(tracker: ProposerPreferencesTracker, currentSlot: number): Promise<void> {
    const drained = this.save(tracker, currentSlot);
    this.closed = true;
    await drained;
  }

  private async flush(): Promise<void> {
    // Publish the running promise before a cache hit can finish synchronously.
    await Promise.resolve();
    try {
      while (this.pending !== null) {
        const text = this.pending;
        this.pending = null;
        if (text === this.persisted) continue;
        try {
          await this.write(text);
          this.persisted = text;
        } catch (error) {
          this.logger.warn("Unable to persist proposer preferences cache", {}, error as Error);
        }
      }
    } finally {
      this.running = null;
    }
  }

  private async write(text: string): Promise<void> {
    const temporary = `${this.filename}.tmp`;
    await fs.rm(temporary, {force: true});
    const file = await fs.open(temporary, "wx", 0o600);
    try {
      await file.writeFile(text);
      await file.sync();
    } finally {
      await file.close();
    }
    await fs.rename(temporary, this.filename);
    const directory = await fs.open(path.dirname(this.filename), "r");
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  }
}

function digest(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}
