import type {BuildHandle, BuildRequest, BuiltPayload, PayloadSource, PayloadSourceResources} from "@lodestar/builder";
import {PayloadSourceNotReady, isAlternateBuild} from "@lodestar/builder";
import {LodestarError} from "@lodestar/utils";

export enum ForkTransitionPayloadErrorCode {
  UNKNOWN_HANDLE = "FORK_TRANSITION_PAYLOAD_UNKNOWN_HANDLE",
  UNKNOWN_PAYLOAD = "FORK_TRANSITION_PAYLOAD_UNKNOWN_PAYLOAD",
  ALTERNATE_UNSUPPORTED = "FORK_TRANSITION_PAYLOAD_ALTERNATE_UNSUPPORTED",
  RETAINED_UNSUPPORTED = "FORK_TRANSITION_PAYLOAD_RETAINED_UNSUPPORTED",
}

export class ForkTransitionPayloadError extends LodestarError<{code: ForkTransitionPayloadErrorCode}> {}

/** Select one constructor per build; retained handles keep their original source across the slot boundary. */
export class ForkTransitionPayloadSource implements PayloadSource {
  private readonly owners = new WeakMap<
    BuildHandle,
    {source: PayloadSource; getPayloadAt?: number; snapshot?: Promise<BuiltPayload>}
  >();
  private readonly payloadOwners = new WeakMap<BuiltPayload, {source: PayloadSource; handle: BuildHandle}>();

  constructor(
    private readonly sessions: PayloadSource,
    private readonly engine: PayloadSource,
    private readonly engineUntilSlot: number,
    private readonly engineSnapshotLeadMs: number
  ) {}

  get id(): string {
    return this.sessions.id;
  }

  get supportsUpdates(): boolean {
    return this.sessions.supportsUpdates === true;
  }

  get supportsBoundedAlternates(): boolean {
    return this.sessions.supportsBoundedAlternates === true;
  }

  get supportsRetainedOffers(): boolean {
    return (
      this.sessions.supportsRetainedOffers === true &&
      this.sessions.renewOffer !== undefined &&
      this.sessions.releaseOffer !== undefined
    );
  }

  get supportsPrimaryHandoff(): boolean {
    return (
      this.supportsRetainedOffers &&
      this.sessions.supportsPrimaryHandoff === true &&
      this.sessions.retainPrimaryPayload !== undefined
    );
  }

  getResources(): PayloadSourceResources | undefined {
    return this.sessions.getResources?.();
  }

  async reconcileResources(signal: AbortSignal): Promise<void> {
    await this.sessions.reconcileResources?.(signal);
  }

  async prepare(request: BuildRequest, signal: AbortSignal): Promise<BuildHandle> {
    signal.throwIfAborted();
    const source = request.payloadAttributes.slotNumber <= this.engineUntilSlot ? this.engine : this.sessions;
    if (source === this.engine && isAlternateBuild(request)) {
      throw new ForkTransitionPayloadError({code: ForkTransitionPayloadErrorCode.ALTERNATE_UNSUPPORTED});
    }
    const handle = await source.prepare(request, signal);
    this.owners.set(handle, {
      source,
      getPayloadAt:
        source === this.engine ? request.payloadAttributes.timestamp * 1000 - this.engineSnapshotLeadMs : undefined,
    });
    return handle;
  }

  async getPayload(handle: BuildHandle, signal: AbortSignal): Promise<BuiltPayload> {
    signal.throwIfAborted();
    const entry = this.owner(handle);
    if (entry.getPayloadAt !== undefined) {
      if (Date.now() < entry.getPayloadAt) throw new PayloadSourceNotReady("Waiting for scheduled Engine snapshot");
      // Engine retrieval can stop construction. Retrieve once at the configured deadline, then retain it.
      entry.snapshot ??= entry.source.getPayload(handle, signal).catch((error: unknown) => {
        entry.snapshot = undefined;
        throw error;
      });
      const payload = await entry.snapshot;
      this.payloadOwners.set(payload, {source: entry.source, handle});
      return payload;
    }
    const payload = await entry.source.getPayload(handle, signal);
    this.payloadOwners.set(payload, {source: entry.source, handle});
    return payload;
  }

  async retainPrimaryPayload(handle: BuildHandle, payload: BuiltPayload, signal: AbortSignal): Promise<BuiltPayload> {
    signal.throwIfAborted();
    const entry = this.owner(handle);
    const owner = this.payloadOwner(payload);
    if (owner.handle !== handle || owner.source !== entry.source) {
      throw new ForkTransitionPayloadError({code: ForkTransitionPayloadErrorCode.UNKNOWN_PAYLOAD});
    }
    if (entry.source !== this.sessions || !this.supportsPrimaryHandoff || !entry.source.retainPrimaryPayload) {
      throw new ForkTransitionPayloadError({code: ForkTransitionPayloadErrorCode.RETAINED_UNSUPPORTED});
    }
    const retained = await entry.source.retainPrimaryPayload(handle, payload, signal);
    // A late reply still owns a native permission that needs independent cleanup.
    this.payloadOwners.set(retained, owner);
    return retained;
  }

  async renewOffer(payload: BuiltPayload, signal: AbortSignal): Promise<boolean> {
    signal.throwIfAborted();
    const owner = this.payloadOwner(payload);
    if (owner.source !== this.sessions || !this.supportsRetainedOffers) return false;
    return (await owner.source.renewOffer?.(payload, signal)) ?? false;
  }

  async releaseOffer(payload: BuiltPayload, signal: AbortSignal): Promise<void> {
    const owner = this.payloadOwner(payload);
    if (owner.source !== this.sessions) return;
    await owner.source.releaseOffer?.(payload, signal);
    this.payloadOwners.delete(payload);
  }

  async release(handle: BuildHandle, signal: AbortSignal): Promise<void> {
    await this.owner(handle).source.release?.(handle, signal);
    this.owners.delete(handle);
  }

  private owner(handle: BuildHandle) {
    const entry = this.owners.get(handle);
    if (!entry) throw new ForkTransitionPayloadError({code: ForkTransitionPayloadErrorCode.UNKNOWN_HANDLE});
    return entry;
  }

  private payloadOwner(payload: BuiltPayload) {
    const owner = this.payloadOwners.get(payload);
    if (!owner) throw new ForkTransitionPayloadError({code: ForkTransitionPayloadErrorCode.UNKNOWN_PAYLOAD});
    return owner;
  }
}
