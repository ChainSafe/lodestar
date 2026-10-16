import {routes} from "@lodestar/api";
import {ApiClient as BuilderApi, getClient} from "@lodestar/api/builder";
import {ChainForkConfig} from "@lodestar/config";
import {Logger} from "@lodestar/logger";
import {DOMAIN_BUILDER_REQUEST_AUTH, ForkPostGloas} from "@lodestar/params";
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

  constructor(
    private readonly opts: BuilderApiClientOpts,
    private readonly config: ChainForkConfig,
    private readonly clock: IClock,
    private readonly bls: IBlsVerifier,
    private readonly metrics: Metrics | null = null,
    private readonly logger?: Logger
  ) {
    this.bidDeadline = opts.bidDeadline ?? DEFAULT_BUILDER_BID_DEADLINE_MS;
    this.bidDelay = opts.bidDelay ?? DEFAULT_BUILDER_BID_DELAY_MS;
    this.bidRequests = opts.bidRequests ?? DEFAULT_BUILDER_BID_REQUESTS;
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

    // Collected in arrival order so an earlier received bid wins ties during candidate ranking,
    // a bid returned unchanged to the same request in a later round is not collected again
    const bids: BuilderApiBid[] = [];
    const seenBids = new Set<string>();
    const rounds = getBidRounds(this.clock.msFromSlot(slot), this.bidDelay, this.bidDeadline, this.bidRequests);
    const collection = Promise.all(
      rounds.map(async (round) => {
        // A round due now is sent even if the signal is about to abort, it is the last fallback
        const waitMs = round.startMs - this.clock.msFromSlot(slot);
        if (waitMs > 0) {
          try {
            await sleep(waitMs, signal);
          } catch (e) {
            if (e instanceof ErrorAborted) return;
            throw e;
          }
          if (signal?.aborted) return;
        }
        await Promise.all(
          requests.map(async ({requestKey, url, entry}) => {
            this.metrics?.builderApi.bidRequests.inc();
            try {
              const client = await this.getOrCreateClient(url, proposerPubkey, entry.auth);
              const res = await client.getExecutionPayloadBid(
                {
                  slot,
                  parentHash,
                  parentRoot,
                  proposerPubkey,
                  requestAuth: entry.auth,
                  dateMilliseconds: Date.now(),
                  timeoutMs: this.bidDeadline,
                },
                // Event loop lag must not discard bids that arrived in time
                {timeoutMs: this.bidDeadline + BUILDER_BID_LAG_BUFFER_MS}
              );
              const signedBid = res.value();
              if (signedBid === undefined) {
                this.logger?.debug("No bid received from builder", {slot, builder: toPrintableUrl(url)});
                return;
              }
              this.metrics?.builderApi.bidsReceived.inc();
              const bidKey = `${requestKey}-${toHex(signedBid.signature)}`;
              if (seenBids.has(bidKey)) {
                return;
              }
              seenBids.add(bidKey);
              bids.push({url, entry, signedBid, receivedMs: this.clock.msFromSlot(slot)});
            } catch (e) {
              this.metrics?.builderApi.bidRequestErrors.inc();
              this.logger?.warn("Failed to get bid from builder", {slot, builder: toPrintableUrl(url)}, e as Error);
            }
          })
        );
      })
    );

    if (signal === undefined) {
      await collection;
    } else {
      await Promise.race([
        collection,
        new Promise<void>((resolve) => {
          if (signal.aborted) resolve();
          else signal.addEventListener("abort", () => resolve(), {once: true});
        }),
      ]);
      if (bids.length === 0) {
        await collection;
      }
    }

    return bids;
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
