const finalizers = new FinalizationRegistry(({route, handle}) => {
  try {
    route.deref()?.incomingTerminal(handle, 2, undefined, undefined);
    route.deref()?.incomingRelease(handle);
  } catch {
    // Runtime teardown may have already retired this handle.
  }
});

function failure(code) {
  return Object.assign(new Error(code), {code});
}

function release(state) {
  if (!state.done || state.retained || state.released) return;
  state.released = true;
  try {
    state.route.deref()?.incomingRelease(state.handle);
  } catch {
    // Runtime teardown also releases native serving capacity.
  }
}

export class NativeIncoming {
  #state;
  #terminal = false;
  #retentionRegistered = false;

  constructor(native, descriptor) {
    const state = {
      done: false,
      handle: descriptor.handle,
      released: false,
      retained: false,
      route: new WeakRef(native),
    };
    this.#state = state;
    this.peerId = descriptor.peerId;
    this.connection = descriptor.connection;
    this.protocol = descriptor.protocol;
    this.data = descriptor.data;
    this.closed = descriptor.closed;
    this.closed.then(() => {
      state.done = true;
      finalizers.unregister(state);
      release(state);
    });
    finalizers.register(this, state, state);
  }

  /** Retains serving capacity through completion of work that can outlive stream cancellation. */
  retainUntil(retired) {
    const state = this.#state;
    if (state.done || this.#retentionRegistered) throw failure("NetworkIncomingRetentionInvalid");
    this.#retentionRegistered = true;
    state.retained = true;
    const finish = () => {
      state.retained = false;
      release(state);
    };
    Promise.resolve(retired).then(finish, finish);
  }

  respond(data, context) {
    return this.#await((native, handle) => native.incomingRespond(handle, data, context));
  }
  ready() {
    return this.#await((native, handle) => native.incomingReady(handle));
  }

  #await(start) {
    const state = this.#state;
    if (state.done || this.#terminal) return Promise.reject(failure("NetworkIncomingClosed"));
    const native = state.route.deref();
    if (!native) return Promise.reject(failure("NetworkClosed"));
    try {
      return start(native, state.handle);
    } catch (error) {
      return Promise.reject(error);
    }
  }

  #end(action, status, message) {
    const state = this.#state;
    if (state.done || (this.#terminal && action !== 2)) return this.closed;
    try {
      state.route.deref()?.incomingTerminal(state.handle, action, status, message);
      this.#terminal = true;
      return this.closed;
    } catch (error) {
      if (error.code === "NetworkIncomingClosed") return this.closed;
      return Promise.reject(error);
    }
  }

  finish() {
    return this.#end(0);
  }
  fail(status, message) {
    return this.#end(1, status, message);
  }
  cancel() {
    return this.#end(2);
  }
}
