import {Agent} from "node:https";
import {routes} from "@lodestar/api";
import {ApiClient as BuilderApi, getClient} from "@lodestar/api/builder";
import {ChainForkConfig} from "@lodestar/config";
import {Logger} from "@lodestar/logger";
import {DOMAIN_BUILDER_REQUEST_AUTH, ForkName, ForkPostGloas} from "@lodestar/params";
import {
  ZERO_HASH,
  computeDomain,
  computeSigningRoot,
  createSingleSignatureSetFromComponents,
} from "@lodestar/state-transition";
import {BLSPubkey, Root, SignedBeaconBlock, Slot, WithOptionalBytes, gloas, ssz} from "@lodestar/types";
import {ErrorAborted, isValidAsciiHttpUrl, sleep, toHex, toPrintableUrl} from "@lodestar/utils";
import type {IBlsVerifier} from "../../chain/bls/index.js";
import {Metrics} from "../../metrics/metrics.js";
import {IClock} from "../../util/clock.js";
import {StreamedBuilderBid, getExecutionPayloadBidStream} from "./bidStream.js";

const MAX_CONCURRENT_BID_STREAMS = 64;

/**
 * Additional duration to account for potential event loop lag which causes
 * builder bids to be rejected even though the response was sent in time.
 */
export const BUILDER_BID_LAG_BUFFER_MS = 250;

/**
 * Default duration given to a builder to provide a `SignedExecutionPayloadBid` before the deadline
 * is reached, advertised on each bid request via the `X-Timeout-Ms` header. Bids received via
 * p2p are given the same time to bid up.
 */
export const DEFAULT_BUILDER_BID_DEADLINE_MS = 500;
/** Default delay from the slot start before the first bid request, in milliseconds */
export const DEFAULT_BUILDER_BID_DELAY_MS = 0;
/** Default number of consecutive bid requests per proposal */
export const DEFAULT_BUILDER_BID_REQUESTS = 1;

export type BuilderApiClientOpts = {
  /** Timeout for builder api requests, bid requests are bounded by `bidDeadline` instead */
  timeout?: number;
  /** Time builders are given to provide a bid once block production starts, in milliseconds */
  bidDeadline?: number;
  /** Delay from the slot start before the first bid request, in milliseconds */
  bidDelay?: number;
  /** Number of consecutive bid requests per proposal, each granting `bidDeadline` */
  bidRequests?: number;
  /** Prefer the Gloas WebSocket bid stream, falling back to HTTP before an upgrade */
  bidStream?: boolean;
  // Add User-Agent header to all requests
  userAgent?: string;
};

type BuilderUrl = string;

/** Decode the SSZ URL bytes without allowing replacement characters or unsafe header values. */
export function decodeBuilderUrl(value: Uint8Array): BuilderUrl {
  let url: string;
  try {
    url = new TextDecoder("utf8", {fatal: true}).decode(value);
  } catch {
    throw Error("Builder url must be valid UTF-8");
  }
  if (!isValidAsciiHttpUrl(url)) {
    throw Error("Invalid builder url");
  }
  return url;
}

export type BuilderApiBid = {
  url: BuilderUrl;
  entry: routes.validator.BuilderEntry;
  signedBid: gloas.SignedExecutionPayloadBid;
  /** Time in milliseconds from the slot start when the bid was received */
  receivedMs: number;
};

/** Bid request round as milliseconds from the slot start */
export type BidRound = {startMs: number; deadlineMs: number};

/**
 * Round i is scheduled at `bidDelay + i * bidDeadline` from the slot start, but never before the
 * block production request or the deadline of the previous round. Every round grants the full deadline,
 * a request still using the lag buffer when the next round starts overlaps with it.
 */
export function getBidRounds(
  msFromSlot: number,
  bidDelay: number,
  bidDeadline: number,
  bidRequests: number
): BidRound[] {
  const rounds: BidRound[] = [];
  let earliestMs = msFromSlot;
  for (let i = 0; i < bidRequests; i++) {
    const startMs = Math.max(earliestMs, bidDelay + i * bidDeadline);
    const deadlineMs = startMs + bidDeadline;
    rounds.push({startMs, deadlineMs});
    earliestMs = deadlineMs;
  }
  return rounds;
}

/**
 * External builder integration post-gloas
 *
 * The builder set is driven by the resolved `BuilderConfig` the validator client supplies on
 * each block production request, clients are dialed on demand based on the entry `url`.
 */
export class BuilderApiClient {
  readonly bidDeadline: number;
  readonly bidDelay: number;
  readonly bidRequests: number;
  private readonly clients = new Map<BuilderUrl, BuilderApi>();
  private activeStreams = 0;
  private streamAgent?: Agent;

  constructor(
    private readonly opts: BuilderApiClientOpts,
    private readonly config: ChainForkConfig,
    private readonly clock: IClock,
    private readonly bls: IBlsVerifier,
    private readonly metrics: Metrics | null = null,
    private readonly logger?: Logger,
    private readonly signal?: AbortSignal
  ) {
    this.bidDeadline = opts.bidDeadline ?? DEFAULT_BUILDER_BID_DEADLINE_MS;
    this.bidDelay = opts.bidDelay ?? DEFAULT_BUILDER_BID_DELAY_MS;
    this.bidRequests = opts.bidRequests ?? DEFAULT_BUILDER_BID_REQUESTS;
    signal?.addEventListener("abort", () => this.streamAgent?.destroy(), {once: true});
  }

  /** Time from now until the last bid request of the slot reaches its deadline */
  getBidWindowMs(slot: Slot): number {
    const msFromSlot = this.clock.msFromSlot(slot);
    const rounds = getBidRounds(msFromSlot, this.bidDelay, this.bidDeadline, this.bidRequests);
    return (rounds.at(-1)?.deadlineMs ?? msFromSlot) - msFromSlot;
  }

  /**
   * Fan out bid requests to the builders named by the entries, one request per unique
   * `(url, auth.message.data)` pair and round, see `getBidRounds`. Errors and empty responses (204)
   * are logged and filtered out so a single unresponsive builder never fails block production.
   * Once the signal is aborted no further round is started and the bids collected so far are
   * returned, unless there is none yet, then the requests in flight are awaited.
   */
  async getExecutionPayloadBids(
    entries: routes.validator.BuilderEntry[],
    slot: Slot,
    parentHash: Root,
    parentRoot: Root,
    proposerPubkey: BLSPubkey,
    signal?: AbortSignal
  ): Promise<BuilderApiBid[]> {
    const streamController = new AbortController();
    const streamSignal = this.signal
      ? AbortSignal.any([streamController.signal, this.signal])
      : streamController.signal;
    const roundSignal = signal && this.signal ? AbortSignal.any([signal, this.signal]) : (signal ?? this.signal);
    const seenRequests = new Set<string>();
    const requests: {requestKey: string; url: BuilderUrl; entry: routes.validator.BuilderEntry}[] = [];

    for (const entry of entries) {
      const urlForLog = Buffer.from(entry.url).toString("utf8");
      let url: BuilderUrl;
      try {
        url = decodeBuilderUrl(entry.url);
      } catch {
        this.logger?.warn("Ignoring builder entry with invalid url", {slot, url: urlForLog});
        continue;
      }

      const requestKey = `${url}-${toHex(entry.auth.message.data)}`;
      if (seenRequests.has(requestKey)) {
        continue;
      }
      seenRequests.add(requestKey);

      // The builder rejects a mismatch, an entry naming a different slot is not used for a bid request
      if (entry.auth.message.slot !== slot) {
        this.logger?.warn("Ignoring builder entry with auth for different slot", {
          slot,
          authSlot: entry.auth.message.slot,
          builder: toPrintableUrl(url),
        });
        continue;
      }

      requests.push({requestKey, url, entry});
    }

    // Snapshot each round synchronously on receipt so a cutoff cannot lose a revision while its
    // stream is closing. A lower replacement supersedes the previous revision in that round.
    const candidates = new Map<string, {requestKey: string; bid: BuilderApiBid}>();
    const rounds = getBidRounds(this.clock.msFromSlot(slot), this.bidDelay, this.bidDeadline, this.bidRequests);
    const collection = Promise.all(
      rounds.map(async (round, roundIndex) => {
        // A round due now is sent even if the signal is about to abort, it is the last fallback
        const waitMs = round.startMs - this.clock.msFromSlot(slot);
        if (waitMs > 0) {
          try {
            await sleep(waitMs, roundSignal);
          } catch (e) {
            if (e instanceof ErrorAborted) return;
            throw e;
          }
          if (roundSignal?.aborted) return;
        }
        await Promise.all(
          requests.map(async ({requestKey, url, entry}) => {
            this.metrics?.builderApi.bidRequests.inc();
            try {
              const key = `${roundIndex}-${requestKey}`;
              const collect = (bid: StreamedBuilderBid): void => {
                if (!streamSignal.aborted) candidates.set(key, {requestKey, bid: {url, entry, ...bid}});
              };
              const client = await this.getOrCreateClient(url, proposerPubkey, entry.auth);
              const bid = await this.requestBid(
                client,
                url,
                entry,
                slot,
                parentHash,
                parentRoot,
                proposerPubkey,
                streamSignal,
                collect,
                signal
              );
              if (bid === undefined) {
                this.logger?.debug("No bid received from builder", {slot, builder: toPrintableUrl(url)});
                return;
              }
              this.metrics?.builderApi.bidsReceived.inc();
              collect(bid);
            } catch (e) {
              this.metrics?.builderApi.bidRequestErrors.inc();
              this.logger?.warn("Failed to get bid from builder", {slot, builder: toPrintableUrl(url)}, e as Error);
            }
          })
        );
      })
    );

    let onAbort: (() => void) | undefined;
    try {
      if (signal === undefined) {
        await collection;
      } else {
        await Promise.race([
          collection,
          new Promise<void>((resolve) => {
            onAbort = resolve;
            if (signal.aborted) resolve();
            else signal.addEventListener("abort", onAbort, {once: true});
          }),
        ]);
        if (candidates.size === 0) await collection;
      }
      const bids = new Map<string, BuilderApiBid>();
      for (const {requestKey, bid} of candidates.values()) {
        const key = `${requestKey}-${toHex(bid.signedBid.signature)}`;
        const previous = bids.get(key);
        if (!previous || bid.receivedMs < previous.receivedMs) bids.set(key, bid);
      }
      return [...bids.values()].sort((a, b) => a.receivedMs - b.receivedMs);
    } finally {
      if (onAbort) signal?.removeEventListener("abort", onAbort);
      streamController.abort();
    }
  }

  private async requestBid(
    client: BuilderApi,
    url: BuilderUrl,
    entry: routes.validator.BuilderEntry,
    slot: Slot,
    parentHash: Root,
    parentRoot: Root,
    proposerPubkey: BLSPubkey,
    signal: AbortSignal,
    onBid: (bid: StreamedBuilderBid) => void,
    stopSignal?: AbortSignal
  ): Promise<StreamedBuilderBid | undefined> {
    if (signal.aborted) return undefined;
    const started = performance.now();
    let timeoutMs = this.bidDeadline;
    let requestTimeoutMs = timeoutMs + BUILDER_BID_LAG_BUFFER_MS;
    if (
      this.opts.bidStream &&
      this.config.getForkName(slot) === ForkName.gloas &&
      this.activeStreams < MAX_CONCURRENT_BID_STREAMS
    ) {
      this.activeStreams++;
      try {
        const result = await getExecutionPayloadBidStream({
          url,
          slot,
          parentHash,
          parentRoot,
          proposerPubkey,
          requestAuth: entry.auth,
          dateMilliseconds: Date.now(),
          timeoutMs,
          requestTimeoutMs,
          userAgent: this.opts.userAgent,
          agent: new URL(url).protocol === "https:" ? this.getStreamAgent() : undefined,
          signal,
          stopSignal,
          msFromSlot: () => this.clock.msFromSlot(slot),
          onBid,
        });
        const elapsed = performance.now() - started;
        timeoutMs = Math.floor(this.bidDeadline - elapsed);
        requestTimeoutMs = Math.floor(this.bidDeadline + BUILDER_BID_LAG_BUFFER_MS - elapsed);
        this.logger?.info("Builder bid stream received", {
          slot,
          builder: toPrintableUrl(url),
          parentHash: toHex(parentHash),
          parentRoot: toHex(parentRoot),
          upgraded: result.upgraded,
          opened: result.opened,
          updates: result.updates,
          discarded: result.discarded,
          reason: result.reason,
          statusCode: result.statusCode,
          durationMs: Math.round(elapsed),
          fallback: !result.upgraded && !signal.aborted && timeoutMs > 0,
          ...(result.bid
            ? {
                receivedMs: result.bid.receivedMs,
                blockHash: toHex(result.bid.signedBid.message.blockHash),
                builderIndex: result.bid.signedBid.message.builderIndex,
                value: result.bid.signedBid.message.value,
              }
            : {}),
        });
        if (result.upgraded || signal.aborted || timeoutMs <= 0) return result.bid;
      } finally {
        this.activeStreams--;
      }
    }
    if (signal.aborted) return undefined;
    const res = await client.getExecutionPayloadBid(
      {slot, parentHash, parentRoot, proposerPubkey, requestAuth: entry.auth, dateMilliseconds: Date.now(), timeoutMs},
      {timeoutMs: requestTimeoutMs, signal, redirect: "manual"}
    );
    const signedBid = res.value();
    return signedBid ? {signedBid, receivedMs: this.clock.msFromSlot(slot)} : undefined;
  }

  private getStreamAgent(): Agent {
    // ws supplies createConnection, bypassing Node's global agent and its TLS session cache.
    this.streamAgent ??= new Agent({
      keepAlive: true,
      maxSockets: MAX_CONCURRENT_BID_STREAMS,
      maxTotalSockets: MAX_CONCURRENT_BID_STREAMS,
      maxFreeSockets: 16,
      maxCachedSessions: 64,
    });
    return this.streamAgent;
  }

  /** Forward a proposer's builder preferences to the builder at the given url */
  async submitBuilderPreferences(
    url: BuilderUrl,
    proposerPubkey: BLSPubkey,
    request: gloas.BuilderPreferencesRequest
  ): Promise<void> {
    try {
      const client = await this.getOrCreateClient(url, proposerPubkey, request.auth);
      (await client.submitBuilderPreferences({proposerPubkey, request})).assertOk();
      this.metrics?.builderApi.preferencesForwarded.inc({status: "success"});
    } catch (e) {
      this.metrics?.builderApi.preferencesForwarded.inc({status: "error"});
      throw e;
    }
  }

  /**
   * Submit the signed beacon block to the builder whose bid was included. The builder is
   * then responsible for constructing and broadcasting the corresponding
   * `SignedExecutionPayloadEnvelope`, no further action is required by the proposer.
   */
  async submitSignedBeaconBlock(
    url: BuilderUrl,
    signedBlock: WithOptionalBytes<SignedBeaconBlock<ForkPostGloas>>
  ): Promise<void> {
    const client = this.clients.get(url);
    if (client === undefined) {
      this.metrics?.builderApi.blockSubmissions.inc({status: "error"});
      this.logger?.warn("Ignoring signed block submission to unauthenticated builder", {url});
      return;
    }

    try {
      (await client.submitSignedBeaconBlock({signedBlock}, {redirect: "manual"})).assertOk();
      this.metrics?.builderApi.blockSubmissions.inc({status: "success"});
    } catch (e) {
      this.metrics?.builderApi.blockSubmissions.inc({status: "error"});
      throw e;
    }
  }

  /**
   * Establish the connection to every known builder outside the bid deadline, a cold TCP/TLS handshake
   * to a distant builder can exhaust the bid deadline on its own, and a long idle connection
   * may be half-open and only fail once written to.
   */
  async checkStatus(): Promise<void> {
    await Promise.all(
      Array.from(this.clients.entries()).map(async ([url, client]) => {
        try {
          (await client.status()).assertOk();
          this.metrics?.builderApi.statusChecks.inc({status: "success"});
          this.logger?.debug("Builder is ready", {builder: toPrintableUrl(url)});
        } catch (e) {
          this.metrics?.builderApi.statusChecks.inc({status: "error"});
          this.logger?.warn("Builder status check failed", {builder: toPrintableUrl(url)}, e as Error);
        }
      })
    );
  }

  private async getOrCreateClient(
    url: BuilderUrl,
    proposerPubkey: BLSPubkey,
    auth: gloas.SignedBuilderRequestAuth
  ): Promise<BuilderApi> {
    if (auth.message.data.length === 0) {
      throw Error("Builder request auth data must not be empty");
    }

    let client = this.clients.get(url);
    if (client === undefined) {
      const domain = computeDomain(DOMAIN_BUILDER_REQUEST_AUTH, this.config.GENESIS_FORK_VERSION, ZERO_HASH);
      const signingRoot = computeSigningRoot(ssz.gloas.BuilderRequestAuth, auth.message, domain);
      const signatureSet = createSingleSignatureSetFromComponents(proposerPubkey, signingRoot, auth.signature);

      let isValid = false;
      try {
        isValid = await this.bls.verifySignatureSets([signatureSet]);
      } catch {
        // Malformed signatures are invalid request authentication.
      }
      if (!isValid) {
        throw Error("Invalid builder request auth");
      }

      client = getClient(
        {
          baseUrl: url,
          globalInit: {
            timeoutMs: this.opts.timeout,
            redirect: "manual",
            headers: this.opts.userAgent ? {"User-Agent": this.opts.userAgent} : undefined,
          },
        },
        {config: this.config, metrics: this.metrics?.builderHttpClient, logger: this.logger}
      );
      this.clients.set(url, client);
      this.logger?.debug("External builder registered", {url: toPrintableUrl(url)});
    }
    return client;
  }
}
