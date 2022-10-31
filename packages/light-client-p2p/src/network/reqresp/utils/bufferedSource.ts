import {Uint8ArrayList} from "uint8arraylist";

/**
 * Wraps a buffer chunk stream source with another async iterable
 * so it can be reused in multiple for..of statements.
 *
 * Uses a BufferList internally to make sure all chunks are consumed
 * when switching consumers
 */
export class BufferedSource {
  isDone = false;
  private buffer: Uint8ArrayList;
  private source: AsyncGenerator<Uint8ArrayList>;

  constructor(source: AsyncGenerator<Uint8ArrayList>) {
    this.buffer = new Uint8ArrayList();
    this.source = source;
  }

  [Symbol.asyncIterator](): AsyncIterator<Uint8ArrayList> {
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

        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const {done, value: chunk} = await that.source.next();
        if (done === true) {
          that.isDone = true;
          return {done: true, value: undefined};
        } else {
          // Concat new chunk and return a reference to its BufferList instance
          that.buffer.append(chunk);
          return {done: false, value: that.buffer};
        }
      },
    };
  }
}
