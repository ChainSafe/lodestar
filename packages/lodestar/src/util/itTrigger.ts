/**
 * Same as [`it-pushable`](https://github.com/alanshaw/it-pushable/blob/76a67cbe92d1db940311ee07775dbc662697e09c/index.d.ts)
 * but it does not buffer values, and this.end() stops the AsyncGenerator immediately
 */
export class ItTrigger {
  private triggered = false;
  private ended = false;
  private error?: Error;
  private onNext?: () => void;

  trigger(): void {
    this.triggered = true;
    if (this.onNext) this.onNext();
  }
  end(err?: Error): void {
    if (err) this.error = err;
    else this.ended = true;
    if (this.onNext) this.onNext();
  }

  // AsyncGenerator API

  [Symbol.asyncIterator](): this {
    return this;
  }
  async next(): ReturnType<AsyncGenerator["next"]> {
    if (this.error) throw this.error;
    if (this.ended) return {done: true, value: undefined};
    if (this.triggered) {
      this.triggered = false;
      return {done: false, value: undefined};
    }

    return new Promise((resolve) => {
      this.onNext = () => {
        this.onNext = undefined;
        resolve(this.next());
      };
    });
  }
  async return(): ReturnType<AsyncGenerator["return"]> {
    this.end();
    return {done: true, value: undefined};
  }
  async throw(err: Error): ReturnType<AsyncGenerator["throw"]> {
    this.end(err);
    return {done: true, value: undefined};
  }
}
