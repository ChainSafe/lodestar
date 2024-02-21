/**
 * A ring buffer for reading and writing data in a shared array buffer.
 */
export class RingBuffer<T> {
  private buffer: Uint8Array;
  private size: number;
  private control: Int32Array;

  private serialize: (object: T) => Uint8Array;
  private deserialize: (data: Uint8Array) => T;

  constructor(
    data: SharedArrayBuffer,
    control: SharedArrayBuffer,
    serialize: (object: T) => Uint8Array,
    deserialize: (data: Uint8Array) => T
  ) {
    this.buffer = new Uint8Array(data);
    this.size = this.buffer.length;
    this.control = new Int32Array(control);

    this.serialize = serialize;
    this.deserialize = deserialize;
  }

  /**
   * The number of unread bytes in the buffer.
   */
  get unreadBytes(): number {
    return this.writeIndex - this.readIndex;
  }

  /**
   * The last read index in the buffer.
   */
  get readIndex(): number {
    return Atomics.load(this.control, 0);
  }

  set readIndex(index: number) {
    Atomics.store(this.control, 0, index);
  }

  /**
   * The last write index in the buffer.
   */
  get writeIndex(): number {
    return Atomics.load(this.control, 1);
  }

  set writeIndex(index: number) {
    Atomics.store(this.control, 1, index);
  }

  writeObject(object: T): boolean {
    return this.write(this.serialize(object));
  }

  readObject(): T | undefined {
    const d = this.read();
    if (d === undefined) return undefined;
    return this.deserialize(d);
  }

  /**
   * Write data into the buffer.
   */
  write(data: Uint8Array): boolean {
    if (data.length > this.size) return false;
    // write data length into the buffer, starting at the lastWriteIndex
    // write data into the buffer, starting at the lastWriteIndex + 4
    // if the data doesn't fit at the end of the buffer, wrap around to the beginning, but don't overwrite unread data
    const writeIndex = this.writeIndex;
    const dataStartIndex = writeIndex + 4;
    const nextWriteIndex = writeIndex + 4 + data.length;
    if (nextWriteIndex >= this.size && dataStartIndex < this.size) {
      // doesn't fit at the end of the buffer, wrap around to the beginning
      if (nextWriteIndex % this.size >= this.readIndex) {
        // doesn't fit because it would overwrite unread data
        return false;
      }
      // how much of data fits at the end of the buffer
      const splitIndex = this.size - dataStartIndex;

      // write the data in two parts
      this.buffer.set(data.subarray(0, splitIndex), dataStartIndex);
      this.buffer.set(data.subarray(splitIndex), 0);
    } else {
      // write the data in one part
      this.buffer.set(data, dataStartIndex % this.size);
    }

    // write the data length
    this.buffer[writeIndex] = data.length >> 24;
    this.buffer[(writeIndex + 1) % this.size] = data.length >> 16;
    this.buffer[(writeIndex + 2) % this.size] = data.length >> 8;
    this.buffer[(writeIndex + 3) % this.size] = data.length;

    // update the lastWriteIndex
    this.writeIndex = nextWriteIndex % this.size;
    return true;
  }

  /**
   * Read data from the buffer.
   */
  read(): Uint8Array | undefined {
    const readIndex = this.readIndex;
    if (readIndex === this.writeIndex) {
      return undefined;
    }

    const length =
      (this.buffer[readIndex] << 24) |
      (this.buffer[(readIndex + 1) % this.size] << 16) |
      (this.buffer[(readIndex + 2) % this.size] << 8) |
      this.buffer[(readIndex + 3) % this.size];
    const data = new Uint8Array(length);

    const dataStartIndex = readIndex + 4;
    const nextReadIndex = readIndex + length + 4;
    if (nextReadIndex >= this.size && dataStartIndex < this.size) {
      // how much of data fits at the end of the buffer
      const splitIndex = this.size - dataStartIndex;

      // read the data in two parts
      data.set(this.buffer.subarray(readIndex + 4, readIndex + 4 + splitIndex), 0);
      data.set(this.buffer.subarray(0, length - splitIndex), splitIndex);
    } else {
      // read the data in one part
      data.set(this.buffer.subarray(dataStartIndex % this.size, nextReadIndex % this.size));
    }

    // update the lastReadIndex
    this.readIndex = nextReadIndex % this.size;

    return data;
  }
}
