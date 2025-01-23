import {ChainForkConfig} from "@lodestar/config";
import {DataAvailabilityStatus, MaybeValidExecutionStatus} from "@lodestar/fork-choice";
import {ForkBlobs, ForkName, ForkSeq} from "@lodestar/params";
import {CachedBeaconStateAllForks, computeEpochAtSlot} from "@lodestar/state-transition";
import {RootHex, SignedBeaconBlock, Slot, deneb} from "@lodestar/types";
import {MapDef, toHex, withTimeout} from "@lodestar/utils";

/** State of block + data availability */
enum AvailabilityState {
  /** Available block, unavailable data */
  a_block_na_data,
  /** Available block, available data */
  a_block_a_data,
  /** Unavailable block, available data */
  na_block_a_data,
  /** Unavailable block, unavailable data */
  na_block_na_data,
}

type BlobAvailabilityState =
  | {
      state: AvailabilityState.a_block_na_data;
      block: SignedBeaconBlock<ForkBlobs>;
      blobs: deneb.BlobSidecar[];
    }
  | {
      state: AvailabilityState.na_block_a_data;
      slot: Slot;
      blockRoot: Uint8Array;
      blobs: deneb.BlobSidecar[];
    }
  | {
      state: AvailabilityState.a_block_a_data;
      block: SignedBeaconBlock<ForkBlobs>;
      blobs: deneb.BlobSidecar[];
    }
  | {
      state: AvailabilityState.na_block_na_data;
      slot: Slot;
      blockRoot: Uint8Array;
      blobs: deneb.BlobSidecar[];
    };

type PromiseParts<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: () => void;
};

function createPromiseParts<T>(): PromiseParts<T> {
  let resolve = (_: T): void => {};
  let reject = () => {};
  const promise = new Promise<T>((_resolve, _reject) => {
    resolve = _resolve;
    reject = _reject;
  });
  return {
    promise,
    resolve,
    reject,
  };
}

export class ImportAvailabilityBlobs {
  state: BlobAvailabilityState;

  private signal?: AbortSignal;
  private promises: {
    block: PromiseParts<void>;
    blobs: PromiseParts<void>;
    full: PromiseParts<void>;
  };

  constructor(state: BlobAvailabilityState, signal?: AbortSignal) {
    this.state = state;
    if (signal) {
      this.signal = signal;
      this.signal.addEventListener("abort", () => this.stop(), {once: true});
    }
    this.promises = {
      block: createPromiseParts(),
      blobs: createPromiseParts(),
      full: createPromiseParts(),
    };
  }

  static createFromBlock(block: SignedBeaconBlock<ForkBlobs>): ImportAvailabilityBlobs {
    const blobCount = block.message.body.blobKzgCommitments.length;
    const state = blobCount === 0 ? AvailabilityState.a_block_a_data : AvailabilityState.a_block_na_data;
    return new ImportAvailabilityBlobs({state, block, blobs: new Array(blobCount)});
  }

  static createFromSidecar(sidecar: deneb.BlobSidecar, blockRoot: Uint8Array): ImportAvailabilityBlobs {
    const blobs = new Array(sidecar.index + 1);
    blobs[sidecar.index] = sidecar;
    return new ImportAvailabilityBlobs({
      state: AvailabilityState.na_block_na_data,
      slot: sidecar.signedBlockHeader.message.slot,
      blockRoot,
      blobs,
    });
  }

  static createFromSlotRoot(slot: Slot, blockRoot: Uint8Array): ImportAvailabilityBlobs {
    return new ImportAvailabilityBlobs({
      state: AvailabilityState.na_block_na_data,
      slot,
      blockRoot,
      blobs: [],
    });
  }

  stop(): void {
    this.promises.block.reject();
    this.promises.blobs.reject();
    this.promises.full.reject();
  }

  get slot(): Slot {
    switch (this.state.state) {
      case AvailabilityState.a_block_a_data:
      case AvailabilityState.a_block_na_data:
        return this.state.block.message.slot;
      case AvailabilityState.na_block_a_data:
      case AvailabilityState.na_block_na_data:
        return this.state.slot;
    }
    throw new Error("unreachable");
  }

  get availabilityState(): AvailabilityState {
    return this.state.state;
  }

  addBlock(block: SignedBeaconBlock<ForkBlobs>): void {
    switch (this.state.state) {
      case AvailabilityState.a_block_a_data:
      case AvailabilityState.a_block_na_data:
        return;

      case AvailabilityState.na_block_na_data:
        if (
          block.message.body.blobKzgCommitments.length === this.state.blobs.length &&
          this.state.blobs.every(Boolean)
        ) {
          this.state = {
            state: AvailabilityState.a_block_a_data,
            block,
            blobs: this.state.blobs,
          };
          this.promises.block.resolve();
          this.promises.blobs.resolve();
          this.promises.full.resolve();
        } else {
          this.state = {
            state: AvailabilityState.a_block_na_data,
            block,
            blobs: this.state.blobs,
          };
          this.promises.block.resolve();
        }
        return;

      case AvailabilityState.na_block_a_data:
        this.state = {
          state: AvailabilityState.a_block_a_data,
          block,
          blobs: this.state.blobs,
        };
        this.promises.block.resolve();
        this.promises.full.resolve();
        return;
    }
  }

  addSidecar(sidecar: deneb.BlobSidecar): void {
    switch (this.state.state) {
      case AvailabilityState.a_block_a_data:
      case AvailabilityState.na_block_a_data:
        return;

      case AvailabilityState.na_block_na_data:
        this.state.blobs[sidecar.index] = sidecar;
        // we can't determine if we have all sidecars without the block
        return;

      case AvailabilityState.a_block_na_data:
        this.state.blobs[sidecar.index] = sidecar;

        if (
          (this.state.block as SignedBeaconBlock<ForkBlobs>).message.body.blobKzgCommitments.length ===
            this.state.blobs.length &&
          this.state.blobs.every(Boolean)
        ) {
          this.state = {
            state: AvailabilityState.a_block_a_data,
            block: this.state.block,
            blobs: this.state.blobs,
          };
          this.promises.blobs.resolve();
          this.promises.full.resolve();
        }
    }
  }

  async waitForBlockAvailability(timeout: number): Promise<void> {
    switch (this.state.state) {
      case AvailabilityState.a_block_a_data:
      case AvailabilityState.a_block_na_data:
        return;
    }

    return withTimeout(() => this.promises.block.promise, timeout, this.signal);
  }

  async waitForDataAvailability(timeout: number): Promise<void> {
    switch (this.state.state) {
      case AvailabilityState.a_block_a_data:
      case AvailabilityState.na_block_a_data:
        return;
    }

    return withTimeout(() => this.promises.blobs.promise, timeout, this.signal);
  }

  async waitForFullAvailability(timeout: number): Promise<void> {
    switch (this.state.state) {
      case AvailabilityState.a_block_a_data:
        return;
    }

    return withTimeout(() => this.promises.full.promise, timeout, this.signal);
  }
}

export type ImportAvailability = ImportAvailabilityBlobs; // | ImportAvailabilityPeerDAS;

export class ImportAvailabilityManager {
  config: ChainForkConfig;
  statuses: MapDef<Slot, Map<string, ImportAvailability>>;

  constructor(config: ChainForkConfig) {
    this.config = config;
    this.statuses = new MapDef(() => new Map());
  }

  get(slot: Slot, blockRoot: Uint8Array): ImportAvailability | undefined {
    return this.statuses.get(slot)?.get(toHex(blockRoot));
  }

  getOrCreate(slot: Slot, blockRoot: Uint8Array): ImportAvailability {
    const slotValues = this.statuses.getOrDefault(slot);
    const blockRootHex = toHex(blockRoot);
    let a = slotValues.get(blockRootHex);
    if (!a) {
      a = ImportAvailabilityBlobs.createFromSlotRoot(slot, blockRoot);
      slotValues.set(blockRootHex, a);
    }
    return a;
  }

  pruneTo(slot: Slot): void {
    for (const s of this.statuses.keys()) {
      if (s < slot) {
        this.statuses.delete(s);
      }
    }
  }
}
