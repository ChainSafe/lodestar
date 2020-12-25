import BufferList from "bl";

/**
 * Wraps a buffer chunk stream source with another async iterable
 * so it can be reused in multiple for..of statements. Intercepts
 * and ignores all generator return calls until manually calling
 * bufferedSource.return()
 *
 * Uses a BufferList internally to make sure all chunks are consumed
 * when switching consumers
 */
export class BufferedSource {
  private buffer: BufferList;
  private source: AsyncGenerator<Buffer>;

  constructor(source: AsyncGenerator<Buffer>) {
    this.buffer = new BufferList();
    this.source = source;
  }

  [Symbol.asyncIterator](): AsyncIterator<BufferList> {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const that = this;

    let firstNext = true;

    return {
      async next() {
        // Prevent fetching a new chunk if there are pending bytes
        // not processed by a previous consumer of this BufferedSource
        if (firstNext && that.buffer.length > 0) {
          firstNext = false;
          return {done: false, value: that.buffer};
        }

        const {done, value: chunk} = await that.source.next();
        if (done === true) {
          return {done: true, value: undefined};
        } else {
          // Concat new chunk and return a reference to this instance
          // peristent BufferList
          that.buffer.append(chunk);
          return {done: false, value: that.buffer};
        }
      },

      // Intercept the return call when breaking out of a for..of
      async return() {
        return {done: true, value: undefined};
      },
    };
  }

  async return(): Promise<void> {
    await this.source.return(undefined);
  }

  /**
   * Waits for the stream to yield one or more bytes
   * Return false if the stream has returned, contains no data or all bytes have been consumed
   */
  async hasData(): Promise<boolean> {
    for await (const buffer of this) {
      if (buffer.length > 0) break;
    }
    return this.buffer.length > 0;
  }
}
