import {itBench, setBenchOpts} from "@dapplion/benchmark";
import {phase0, ssz} from "@lodestar/types";

// add one byte for an incrementing "synchronization byte"
const STATUS_BUFFER_SIZE = ssz.phase0.Status.maxSize + 1;

// data will be written to the shared buffer in the following format:
// [ 1 byte for synchronization ][ N bytes for ssz serialized status ]

class StatusCacheWriter {
  // backed by a SharedArrayBuffer
  private readonly buffer: Uint8Array;

  constructor(sab: SharedArrayBuffer) {
    if (sab.byteLength !== STATUS_BUFFER_SIZE) throw new Error("invalid buffer size");
    this.buffer = new Uint8Array(sab);
  }

  update(status: phase0.Status): void {
    this.buffer.set(ssz.phase0.Status.serialize(status), 1);
    Atomics.store(this.buffer, 0, (this.buffer[0] + 1) % 256);
  }
}

class StatusCacheReader {
  // backed by a SharedArrayBuffer
  private readonly buffer: Uint8Array;
  // previously cached status and sync value
  private status: phase0.Status;
  private syncVal: number;

  constructor(sab: SharedArrayBuffer) {
    if (sab.byteLength !== STATUS_BUFFER_SIZE) throw new Error("invalid buffer size");
    this.buffer = new Uint8Array(sab);
    this.syncVal = Atomics.load(this.buffer, 0);
    this.status = ssz.phase0.Status.deserialize(this.buffer.subarray(1));
  }

  get(): phase0.Status {
    const newSyncVal = Atomics.load(this.buffer, 0);
    if (newSyncVal !== this.syncVal) {
      this.syncVal = newSyncVal;
      this.status = ssz.phase0.Status.deserialize(this.buffer.subarray(1));
    }
    return this.status;
  }
}

/**
 * 16_000 items: push then shift  - LinkedList is >200x faster than regular array
 *               push then pop - LinkedList is >10x faster than regular array
 * 24_000 items: push then shift  - LinkedList is >350x faster than regular array
 *               push then pop - LinkedList is >10x faster than regular array
 */
describe("SharedArrayBuffer vs MessageChannel", () => {
  setBenchOpts({noThreshold: true});

  itBench({
    id: "set and get status - MessageChannel",
    runsFactor: 1000,
    before: () => {
      const channel = new MessageChannel();
      return {
        port1: channel.port1,
        port2: channel.port2,
        status: ssz.phase0.Status.defaultValue(),
      };
    },
    beforeEach: ({port1, port2, status}) => {
      const setStatus = (status: phase0.Status): void => port1.postMessage(status);
      const getStatus = new Promise((resolve) => port2.addEventListener("message", resolve, {once: true}));

      return {
        setStatus,
        getStatus,
        status,
      };
    },
    fn: async ({setStatus, getStatus, status}) => {
      setStatus(status);
      await getStatus;
    },
  });

  itBench({
    id: "set and get status - SharedArrayBuffer",
    runsFactor: 1000,
    before: () => {
      const buffer = new SharedArrayBuffer(STATUS_BUFFER_SIZE);
      const reader = new StatusCacheReader(buffer);
      const writer = new StatusCacheWriter(buffer);
      return {
        reader,
        writer,
        status: ssz.phase0.Status.defaultValue(),
      };
    },
    beforeEach: (args) => args,
    fn: ({reader, writer, status}) => {
      writer.update(status);
      reader.get();
    },
  });

  itBench({
    id: "serialize/deserialize status - structuredClone",
    runsFactor: 1000,
    beforeEach: () => ssz.phase0.Status.defaultValue(),
    fn: (status) => void structuredClone(status),
  });

  itBench({
    id: "serialize/deserialize status - ssz",
    runsFactor: 1000,
    beforeEach: () => ssz.phase0.Status.defaultValue(),
    fn: (status) => void ssz.phase0.Status.deserialize(ssz.phase0.Status.serialize(status)),
  });
});
