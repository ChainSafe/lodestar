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
import {isValidAsciiHttpUrl, toHex, toPrintableUrl} from "@lodestar/utils";
import type {IBlsVerifier} from "../../chain/bls/index.js";
import {Metrics} from "../../metrics/metrics.js";
import {IClock} from "../../util/clock.js";

/**
 * Additional duration to account for potential event loop lag which causes
 * builder bids to be rejected even though the response was sent in time.
 */
const EVENT_LOOP_LAG_BUFFER = 250;

/**
 * Duration given to a builder to provide a `SignedExecutionPayloadBid` before the deadline
 * is reached, advertised on each bid request via the `X-Timeout-Ms` header. The p2p bid is
 * selected after the same duration, only considering bids received up to that point.
 */
export const BUILDER_BID_DEADLINE_MS = 500;

/** Local timeout for bid requests, event loop lag must not discard bids that arrived in time */
export const BUILDER_BID_REQUEST_TIMEOUT_MS = BUILDER_BID_DEADLINE_MS + EVENT_LOOP_LAG_BUFFER;

export type BuilderApiClientOpts = {
  /** Timeout for builder api requests, bid requests always use `BUILDER_BID_REQUEST_TIMEOUT_MS` */
  timeout?: number;
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

/**
 * External builder integration post-gloas
 *
 * The builder set is driven by the resolved `BuilderConfig` the validator client supplies on
 * each block production request, clients are dialed on demand based on the entry `url`.
 */
export class BuilderApiClient {
  private readonly clients = new Map<BuilderUrl, BuilderApi>();

  constructor(
    private readonly opts: BuilderApiClientOpts,
    private readonly config: ChainForkConfig,
    private readonly clock: IClock,
    private readonly bls: IBlsVerifier,
    private readonly metrics: Metrics | null = null,
    private readonly logger?: Logger
  ) {}

  /**
   * Fan out bid requests to the builders named by the entries, one request per unique
   * `(url, auth.message.data)` pair. Errors and empty responses (204) are logged and filtered
   * out so a single unresponsive builder never fails block production.
   */
  async getExecutionPayloadBids(
    entries: routes.validator.BuilderEntry[],
    slot: Slot,
    parentHash: Root,
    parentRoot: Root,
    proposerPubkey: BLSPubkey
  ): Promise<BuilderApiBid[]> {
    const seenRequests = new Set<string>();
    const requests: {url: BuilderUrl; entry: routes.validator.BuilderEntry}[] = [];

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

      requests.push({url, entry});
    }

    // Collected in arrival order so an earlier received bid wins ties during candidate ranking
    const bids: BuilderApiBid[] = [];
    await Promise.all(
      requests.map(async ({url, entry}) => {
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
              timeoutMs: BUILDER_BID_DEADLINE_MS,
            },
            {timeoutMs: BUILDER_BID_REQUEST_TIMEOUT_MS}
          );
          const signedBid = res.value();
          if (signedBid === undefined) {
            this.logger?.debug("No bid received from builder", {slot, builder: toPrintableUrl(url)});
            return;
          }
          this.metrics?.builderApi.bidsReceived.inc();
          bids.push({url, entry, signedBid, receivedMs: this.clock.msFromSlot(slot)});
        } catch (e) {
          this.metrics?.builderApi.bidRequestErrors.inc();
          this.logger?.warn("Failed to get bid from builder", {slot, builder: toPrintableUrl(url)}, e as Error);
        }
      })
    );

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
   * to a distant builder can exhaust `BUILDER_BID_DEADLINE_MS` on its own, and a long idle connection
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
      this.logger?.info("External builder registered", {url: toPrintableUrl(url)});
    }
    return client;
  }
}
