# libp2p shutdown hang fix: design and assumptions

## Status

This document describes the second implementation of the Lodestar and js-libp2p shutdown fix.

- Reviewed analysis: <https://gist.github.com/matthewkeil/04aa4748a6f5435b9c88375a9d24fe11>
- Pre-review analysis: <https://gist.github.com/matthewkeil/b7cc2459b7ba1aaf3b42bff9dc8decde>
- js-libp2p branch: <https://github.com/matthewkeil/js-libp2p/tree/mkeil/fix-shutdown-hang-2>
- Lodestar dependency branch: `mkeil/fix-libp2p-hang-deps-2`
- Lodestar integration branch: `mkeil/fix-libp2p-hang-2`

The implementation intentionally does not add `shutdownPostDrainTimeout` or any other fixed shutdown grace period.

## Objective

Make libp2p shutdown deterministic at the lifecycle boundaries Lodestar and js-libp2p control:

1. Reject new connection work as soon as shutdown begins.
2. Represent every admitted outbound TCP dial before user-controlled code can run.
3. Abort every admitted but incomplete outbound operation.
4. Wait for each owned raw socket to emit `close` before reporting the operation drained.
5. Stop TCP listener admission early.
6. Preserve ownership of every listener and admitted inbound socket until final teardown completes.
7. Keep the public Lodestar and libp2p consumer API unchanged.

Node and libuv changes are explicitly out of scope for this branch family.

## Evidence used for the design

The design treats the following as established:

- A dial queue can report idle after `net.connect()` has already dispatched a raw outbound socket.
- The later drain-hotfix specimen identified outbound sockets by ephemeral local ports.
- Awaiting `net.Socket` `close` is strong evidence that Node removed the socket's current `TCPWrap` from `handle_wrap_queue_`.
- `net.Server.close()` synchronously closes listener admission while allowing already admitted sockets to remain open.
- A fixed delay has no completion condition and cannot prove that sockets, upgrades, or native queues are drained.
- The first js-libp2p implementation could miss a dial when shutdown was started by `onProgress` or synchronously inside `net.connect()`.
- The transport manager could lose listener cleanup ownership after an early `close` event, including through `splice(-1, 1)`.

The design does not assume that Phase C proved an inbound connection or a post-sweep `TCPWrap` insertion. The reviewed Node and libuv source does not support a normal accept callback creating a new `TCPWrap` after `CleanupHandles()` has closed the listener.

## Branch and commit isolation

### js-libp2p

`mkeil/fix-shutdown-hang-2` is based on the fork's `main` branch and contains these scoped commits:

1. `fix(tcp): quiesce outbound dials before shutdown`
2. `fix(transports): preserve listeners through shutdown`
3. `fix(connection-manager): reject work during shutdown`
4. `test(transports): type shutdown fixtures`
5. `fix(tcp): await listener close completion`

### Lodestar dependency branch

`mkeil/fix-libp2p-hang-deps-2` is based on current `unstable` and contains only dependency infrastructure:

1. Register the HTTPS js-libp2p submodule and its tracked test branch.
2. Add the preinstall build path and local package overrides.

### Lodestar integration branch

`mkeil/fix-libp2p-hang-2` branches from the dependency branch. It contains this design record and is the branch intended for fleet testing of the implementation.

No Lodestar networking source change is required for this version. Lodestar continues to call the same libp2p stop API. The bounded network-worker termination already present on `unstable` remains independent containment for Node, addons, and other shutdown failures.

## Shutdown protocol

libp2p already separates component shutdown into `beforeStop()` and `stop()` phases. Every component finishes `beforeStop()` before any component begins `stop()`.

This implementation uses those phases as follows:

```text
beforeStop
  connection manager: close admission, stop reconnect and dial queues
  transport manager: close dial/listen admission, snapshot listeners, stop listener admission
  TCP transport: close dial admission, abort and await every admitted dial operation

stop
  connection manager: close tracked upgraded connections
  transport manager: close every listener from its stable snapshot
  TCP listener: abort upgrades, destroy admitted sockets, await socket and server close
```

The component `beforeStop()` hooks are invoked concurrently. Correctness does not depend on their relative order. Each component closes its own admission gate synchronously before its first asynchronous wait.

There is no sleep between the phases. Phase advancement is based only on owned work reaching an explicit completion condition.

## Outbound TCP design

### Operation registration

The TCP transport registers a completion promise before it invokes `_connect()` or any user-controlled callback. The actual dial begins in a microtask only after registration.

This order is intentional:

```text
check admission
  -> register operation
  -> begin dial
  -> invoke onProgress
  -> construct options
  -> call net.connect()
  -> upgrade connection
  -> transfer ownership or close socket
  -> settle operation
```

There is no callback or asynchronous boundary between the admission check and registration. On a JavaScript worker thread, shutdown cannot interleave inside that section.

### Stable shutdown set

TCP `beforeStop()` performs these steps synchronously before awaiting:

1. Set `acceptingDials` to false.
2. Abort the transport-owned shutdown controller.
3. Snapshot the registered operation completions.

Because admission is closed and all earlier dials were registered before user code, the set cannot gain an unrepresented operation after this point.

### Combined abort ownership

Every dial receives a signal combining the caller's abort signal with the transport shutdown signal. The combined signal is passed through connection setup and outbound upgrade.

Checks occur:

- Before `onProgress`.
- After `onProgress`.
- After `net.connect()` returns and the abort listener is installed.
- After outbound upgrade resolves, before ownership is returned.

The post-`net.connect()` check covers synchronous user-controlled lookup functions that start shutdown before `net.connect()` returns its socket.

### Socket close completion

If connection setup or upgrade fails or is aborted, the transport destroys or resets the raw socket and awaits its `close` event. The dial operation does not settle before that event.

If upgrade succeeds, the connection becomes connection-manager-owned and the TCP dial operation is removed without closing the socket.

This replaces both incomplete approaches from the first implementation:

- Waiting only for dial-queue idleness.
- Taking a one-time snapshot only of sockets that `net.connect()` had already returned.

## Inbound TCP design

### Early admission stop

`Listener.stopAccepting?()` is optional so transports that do not support a separate admission phase do not need a compatibility change.

The TCP implementation calls the existing permanent listener pause path. This calls `net.Server.close()` synchronously and changes listener status to inactive. A socket callback delivered after that status change is destroyed instead of entering the upgrader.

The guarantee is deliberately narrow: sockets whose TCP listener callback already ran remain tracked until final teardown. The code does not claim that every connection in an operating-system accept backlog is promoted into libp2p.

### Stable listener ownership

The transport manager stores a listener snapshot before calling `stopAccepting()`. Final `stop()` closes that snapshot even if a listener emits `close` and removes itself from the normal runtime cache during `beforeStop()`.

The runtime close handler now checks `index !== -1` before splicing the listener array. An event from a listener already removed from the cache can no longer remove a different listener.

### Final native completion

The TCP listener retains the `net.Server` close promise when admission stops. Final `close()` then:

1. Reuses the admission stop operation idempotently.
2. Aborts in-progress inbound upgrades.
3. Destroys every admitted socket that has not closed.
4. Awaits every socket `close` event.
5. Awaits the retained server `close` event.

Early admission stop does not await the server close promise because Node emits it only after existing server connections end. Waiting there would collapse the two phases and prevent the final teardown phase from closing those connections.

## Connection and transport manager gates

The connection manager marks itself stopped in `beforeStop()` before stopping its reconnect and dial queues. New inbound admission returns false, and new outbound opens reject with `NotStartedError`.

Outbound connection creation rechecks the gate after user progress callbacks and after the dial queue returns. A connection that materializes after shutdown is aborted instead of being returned without an owner.

The transport manager similarly rejects new dials and listens after `beforeStop()` starts. It rechecks after its selected-transport progress callback because that callback can synchronously initiate shutdown.

## Design assumptions

### Assumption 1: worker-local JavaScript execution is serialized

Admission checks and operation registration execute without an intervening callback. This makes the registry stable once admission is closed.

If a future implementation introduces an await or user getter between those steps, the invariant must be re-audited.

### Assumption 2: `net.Socket.destroy()` or `resetAndDestroy()` eventually emits `close`

Node documents socket close as the native handle completion signal, and `HandleWrap` queue removal occurs before the JavaScript close callback. The implementation intentionally waits for this event without an arbitrary timeout.

If a Node defect violates this invariant, the libp2p stop promise can remain pending. Lodestar's bounded worker termination is the containment for that separate failure. Adding a short timeout inside libp2p would hide loss of ownership and would not prove native cleanup.

### Assumption 3: the upgrader observes abort or underlying stream failure

The transport passes its shutdown signal to the upgrader and aborts the underlying multiaddr connection on failure. A custom upgrader that ignores both abort and stream termination can prevent its operation from settling.

This is treated as a component contract, not solved with a grace timeout.

### Assumption 4: successful upgrade transfers ownership

Once `upgradeOutbound()` resolves, the upgraded connection is expected to be emitted and tracked by the connection manager. The raw TCP operation can then leave the transport registry without closing the connection.

The connection-manager gate and post-upgrade shutdown check cover an upgrade resolving while shutdown is in progress.

### Assumption 5: other transports remain responsible for their own work

`stopAccepting()` is optional and the raw operation registry is TCP-specific. QUIC, WebSockets, WebTransport, relay, and custom transports retain their existing shutdown behavior.

The field evidence motivating this change concerns TCP. Extending the lifecycle contract to other transports should be evidence-driven and implemented independently.

## Intentional temporary hacks

These are deployment and test-fleet accommodations, not parts of the shutdown correctness argument.

### Branch-following submodule update

The preinstall script runs:

```text
git submodule update --init --recursive --remote temp-deps/js-libp2p
```

This intentionally follows the branch configured in `.gitmodules` instead of using only the checked-in gitlink. It allows fleet deployments to consume new commits on the test branch without another Lodestar commit.

This is not appropriate for a reproducible release. Remove `--remote` and pin a reviewed js-libp2p release or commit before merging normal production dependency changes.

### Local dependency overrides

Lodestar overrides `libp2p`, `@libp2p/tcp`, `@libp2p/interface`, and `@libp2p/peer-collections` to submodule workspaces. It also links selected shared dependencies from the submodule to avoid incompatible duplicate package instances across the two workspaces.

These overrides are integration scaffolding and should be removed when Lodestar consumes a published js-libp2p version containing the fix.

### Dependency release cutoff

The submodule install uses a fixed npm `--before` timestamp so caret ranges cannot resolve releases newer than the tested js-libp2p checkout. This is a temporary reproducibility workaround for building an old workspace from source.

### Root `rxjs` installation

The preinstall script installs `rxjs` without saving it because Aegir's task runner expects an observable implementation resolvable from the js-libp2p workspace root. This is build scaffolding only.

## Rejected approaches

### Fixed post-drain timeout

Rejected because elapsed time is not evidence of completion. It cannot prove that dials, upgrades, listener callbacks, sockets, or native handles settled. It also does not address the alleged post-sweep accept race because Node cleanup has not begun while libp2p is sleeping.

### Dial-queue `onIdle()` as the transport barrier

Rejected because an operation can leave the queue before its raw socket connects or closes.

### Returned-socket snapshot

Rejected because shutdown can begin from `onProgress` or synchronously within `net.connect()` before the socket is added to the set.

### Node handle-queue re-sweep in this branch

Deferred. The reviewed source does not demonstrate the TCP path that inserts a wrapper after Node's first sweep. Node instrumentation and a deterministic reproducer should precede a Node-core policy change.

## Validation completed

### js-libp2p

- `@libp2p/interface` lint and build.
- `@libp2p/tcp` lint, dependency check, build, and 41 Node tests.
- `libp2p` lint and build.
- 11 transport-manager tests.
- 22 connection-manager tests.

The added regressions cover:

- Shutdown of a connect-pending socket.
- Reentrant shutdown from `onProgress` before `net.connect()`.
- Reentrant shutdown from inside `net.connect()`.
- Shutdown during outbound upgrade.
- Successful upgrade ownership transfer.
- Dial rejection after shutdown.
- Early listener admission stop without early upgrade abort.
- Stable cleanup of multiple listeners after close events mutate the runtime cache.
- Connection-manager rejection during shutdown.

### Lodestar

- Full `pnpm install`, including submodule update and all required js-libp2p workspace builds.
- `@lodestar/beacon-node` type check.
- `@lodestar/reqresp` type check.
- Bounded worker-termination unit test, 2 passing tests.
- Verification that beacon-node resolves `@libp2p/tcp` and `libp2p` from the local submodule.
- Prettier check for the dependency wiring files.

The local Node version is 24.12.0 while current Lodestar declares `^24.13.0`. Commands completed with the expected engine warning. Fleet validation should use the declared Lodestar Node version.

## Remaining validation

The branch should still be exercised against the original randomized worker-termination scenario and fleet shutdown workload.

High-value observations are:

- Count every admitted TCP dial operation at shutdown start and completion.
- Count sockets destroyed during connect and upgrade.
- Confirm every destroyed socket emits `close` before libp2p stop resolves.
- Compare libp2p ownership inventories with Node native handle inventories before worker termination.
- Separate inbound-only and outbound-only stress runs.
- Capture `TCPWrap` construction, `HandleWrap::Close()`, and `OnClose()` if a worker still hangs.

A remaining hang should not be interpreted automatically as failure of this ownership protocol. It may expose the unresolved Node invariant, a different transport, an addon, or another native resource with the same process-level symptom.

## Removal plan

After fleet validation and upstream review:

1. Merge or publish the js-libp2p fixes.
2. Replace Lodestar's submodule and local overrides with the published versions.
3. Delete both temporary Lodestar branches and the js-libp2p test branch.
4. Continue Node and libuv investigation independently with native lifecycle tracing.
