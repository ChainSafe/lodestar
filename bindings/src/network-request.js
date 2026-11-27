const finalizers = new FinalizationRegistry(({route, handle}) => {
  try {
    route.deref()?.requestRetire(handle, true);
  } catch {
    // Runtime teardown may have already retired this handle.
  }
});

function failure(code) {
  return Object.assign(new Error(code), {code});
}

export class NativeRequest {
  #route;
  #handle;
  #closed;
  #outcome = {error: null, received: false};
  #done = false;
  #pulling = false;
  #retirement;

  constructor(native, {handle, closed}) {
    this.#route = new WeakRef(native);
    this.#handle = handle;
    this.#closed = closed;
    const outcome = this.#outcome;
    // The terminal outcome survives cell reuse without keeping an abandoned iterator alive.
    closed.then((error) => {
      outcome.received = true;
      outcome.error = error;
      finalizers.unregister(outcome);
    });
    finalizers.register(this, {handle, route: this.#route}, outcome);
  }

  [Symbol.asyncIterator]() {
    return this;
  }

  async next() {
    if (this.#done) return {done: true, value: undefined};
    if (this.#pulling) throw failure("NetworkRequestBusy");
    if (this.#outcome.received) {
      this.#finish();
      if (this.#outcome.error !== null) throw this.#outcome.error;
      return {done: true, value: undefined};
    }
    const native = this.#route.deref();
    if (!native) {
      this.#finish();
      throw failure("NetworkClosed");
    }
    this.#pulling = true;
    try {
      const result = await native.requestPull(this.#handle);
      if (result.done) this.#finish();
      return result;
    } catch (error) {
      this.#finish();
      throw error;
    } finally {
      this.#pulling = false;
    }
  }

  #finish() {
    this.#done = true;
    finalizers.unregister(this.#outcome);
  }

  #retire(throwing, value) {
    if (this.#retirement !== undefined) return this.#retirement;
    const streaming = !this.#done && !this.#outcome.received;
    this.#finish();
    const native = streaming ? this.#route.deref() : undefined;
    try {
      native?.requestRetire(this.#handle, false);
      this.#retirement = (native ? this.#closed : Promise.resolve()).then(() => {
        if (throwing) throw value;
        return {done: true, value: undefined};
      });
    } catch (error) {
      this.#retirement = Promise.reject(error);
    }
    return this.#retirement;
  }

  return() {
    return this.#retire(false);
  }
  throw(value) {
    return this.#retire(true, value);
  }
}
