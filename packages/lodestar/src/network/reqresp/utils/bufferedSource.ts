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
  isDone: boolean;
  private buffer: BufferList;
  private source: AsyncGenerator<Buffer>;

  constructor(source: AsyncGenerator<Buffer>) {
    this.buffer = new BufferList();
    this.source = source;
    this.isDone = false;
  }

  [Symbol.asyncIterator](): AsyncIterator<BufferList> {
    const source = this.source;
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const that = this;

    let firstNext = false;

    return {
      async next() {
        // Prevent fetching a new chunk if there are pending bytes
        // not processed by a previous consumer of this BufferedSource
        if (!that.isDone && firstNext && that.buffer.length > 0) {
          firstNext = true;
          return {done: false, value: that.buffer};
        }

        const {done, value: chunk} = await source.next();
        if (done === true) {
          that.isDone = done;
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
}
