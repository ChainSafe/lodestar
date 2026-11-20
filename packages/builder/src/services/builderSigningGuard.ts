import fs from "node:fs";
import path from "node:path";
import {isMainThread} from "node:worker_threads";
import {ClassicLevel} from "classic-level";
import {ensureCommitmentDirectory} from "./commitmentJournal.js";

// POSIX fcntl locks belong to a process: opening and closing a second descriptor
// for LOCK can release the first owner's kernel lock, even when LevelDB rejects
// that second open. Do not let duplicate instances reach the native open path.
// Share this registry across duplicate module loads in the main-thread realm.
const registry = globalThis as typeof globalThis & {[key: symbol]: Set<string> | undefined};
const registryKey = Symbol.for("lodestar.builder.signingDirectories");
const ownedDirectories = registry[registryKey] ?? new Set<string>();
registry[registryKey] = ownedDirectories;

/** The native database lock has no stale timeout: a suspended owner keeps its lock.
 * All replicas must use this same durable directory; copied disks or keys are not fenced. */
export class BuilderSigningGuard {
  private active = true;
  private closing?: Promise<void>;

  private constructor(
    private readonly ownership: ClassicLevel,
    private readonly directoryIdentity: string
  ) {}

  static async acquire(directory: string): Promise<BuilderSigningGuard> {
    if (!isMainThread) throw Error("BUILDER_SIGNER_WORKER_THREAD");
    ensureCommitmentDirectory(directory);
    const canonicalDirectory = fs.realpathSync(directory);
    const info = fs.statSync(canonicalDirectory, {bigint: true});
    const directoryIdentity = `${info.dev}:${info.ino}`;
    if (ownedDirectories.has(directoryIdentity)) throw Error("BUILDER_SIGNER_OWNERSHIP_UNAVAILABLE");
    const ownerDirectory = path.join(canonicalDirectory, ".writer-lock");
    fs.mkdirSync(ownerDirectory, {mode: 0o700, recursive: true});
    if (!fs.lstatSync(ownerDirectory).isDirectory()) throw Error("BUILDER_SIGNER_OWNERSHIP_DIRECTORY");
    // Unlike the shared beacon database, ownership must not share a native handle
    // with a second builder instance or worker thread in this same process.
    ownedDirectories.add(directoryIdentity);
    let ownership: ClassicLevel | undefined;
    try {
      ownership = new ClassicLevel(ownerDirectory, {multithreading: false});
      await ownership.open();
      return new BuilderSigningGuard(ownership, directoryIdentity);
    } catch (error) {
      await ownership?.close();
      ownedDirectories.delete(directoryIdentity);
      throw Error("BUILDER_SIGNER_OWNERSHIP_UNAVAILABLE", {cause: error});
    }
  }

  assertActive(): void {
    if (!this.active) throw Error("BUILDER_SIGNER_OWNERSHIP_RELEASED");
  }

  revoke(): void {
    this.active = false;
  }

  close(): Promise<void> {
    this.revoke();
    this.closing ??= this.ownership.close().then(() => {
      ownedDirectories.delete(this.directoryIdentity);
    });
    return this.closing;
  }
}
