import {ApiClient as BuilderApi, getClient} from "@lodestar/api/builder";
import {ChainForkConfig} from "@lodestar/config";
import {Logger} from "@lodestar/logger";
import {ForkPostGloas} from "@lodestar/params";
import {BLSPubkey, Root, SignedBeaconBlock, Slot, WithOptionalBytes, gloas} from "@lodestar/types";
import {MapDef, toPrintableUrl, toPubkeyHex} from "@lodestar/utils";
import {Metrics} from "../../metrics/metrics.js";

export type GloasExecutionBuilderOpts = {
  timeout?: number;
  // Add User-Agent header to all requests
  userAgent?: string;
};

/**
 * Additional duration to account for potential event loop lag which causes
 * builder bids to be rejected even though the response was sent in time.
 */
const EVENT_LOOP_LAG_BUFFER = 250;

/**
 * Duration given to the builder to provide a `SignedExecutionPayloadBid` before the deadline
 * is reached, only considering bids from the p2p network and the local build process.
 */
const BUILDER_BID_DELAY_TOLERANCE = 1000 + EVENT_LOOP_LAG_BUFFER;

type PubkeyHex = string;
type BuilderUrl = string;

type BuilderEntry = {
  auth: gloas.SignedRequestAuthV1;
  maxExecutionPayment: bigint;
};

export type BuilderApiBid = {
  url: BuilderUrl;
  maxExecutionPayment: bigint;
  signedBid: gloas.SignedExecutionPayloadBid;
};

export type BidSource = {url: BuilderUrl; bidBlockHash: string};

/**
 * External builder integration post-gloas (ePBS), see https://github.com/ethereum/builder-specs/pull/138.
 *
 * The builder set is driven by validator-signed request auths submitted via `submitBuilderPreferences`,
 * clients are dialed on demand based on the builder url the validator signed over (`auth.message.data`).
 */
export class GloasExecutionBuilder {
  private readonly clients = new Map<BuilderUrl, BuilderApi>();
  private readonly buildersByPubkeyBySlot = new MapDef<Slot, MapDef<PubkeyHex, Map<BuilderUrl, BuilderEntry>>>(
    () => new MapDef<PubkeyHex, Map<BuilderUrl, BuilderEntry>>(() => new Map())
  );
  /** Builder api bid included in a produced block, used to route the signed block back to the builder */
  private readonly bidSourceBySlot = new Map<Slot, BidSource>();
  private lowestPermissibleSlot = 0;

  constructor(
    private readonly opts: GloasExecutionBuilderOpts,
    private readonly config: ChainForkConfig,
    private readonly metrics: Metrics | null = null,
    private readonly logger?: Logger
  ) {}

  /**
   * Forward a proposer's builder preferences to the builder identified by `auth.message.data`
   * and cache the auth to authenticate the bid request at proposal time.
   */
  async submitBuilderPreferences(
    validatorPubkey: BLSPubkey,
    request: gloas.BuilderPreferencesRequestV1
  ): Promise<void> {
    const url = Buffer.from(request.auth.message.data).toString("utf8");

    try {
      new URL(url);
    } catch {
      throw Error("Invalid builder url in auth.message.data");
    }

    const slot = request.auth.message.slot;
    if (slot < this.lowestPermissibleSlot) {
      throw Error(`Builder preferences for past slot=${slot} lowestPermissibleSlot=${this.lowestPermissibleSlot}`);
    }

    this.buildersByPubkeyBySlot
      .getOrDefault(slot)
      .getOrDefault(toPubkeyHex(validatorPubkey))
      .set(url, {auth: request.auth, maxExecutionPayment: request.preferences.maxExecutionPayment});

    try {
      (await this.getClientForUrl(url).submitBuilderPreferences({validatorPubkey, request})).assertOk();
      this.metrics?.gloasBuilder.preferencesForwarded.inc({status: "success"});
    } catch (e) {
      this.metrics?.gloasBuilder.preferencesForwarded.inc({status: "error"});
      throw e;
    }
  }

  /** Return true if there are registered builders for this proposal slot and proposer */
  hasRegisteredBuilders(slot: Slot, proposerPubkey: BLSPubkey): boolean {
    const builders = this.buildersByPubkeyBySlot.get(slot)?.get(toPubkeyHex(proposerPubkey));
    return builders !== undefined && builders.size > 0;
  }

  /**
   * Fan out bid requests to all builders registered for this proposal slot and proposer.
   * Errors and empty responses (204) are logged and filtered out.
   */
  async getExecutionPayloadBids(
    slot: Slot,
    parentHash: Root,
    parentRoot: Root,
    proposerPubkey: BLSPubkey
  ): Promise<BuilderApiBid[]> {
    const builders = this.buildersByPubkeyBySlot.get(slot)?.get(toPubkeyHex(proposerPubkey));
    if (builders === undefined || builders.size === 0) {
      return [];
    }

    const bids = await Promise.all(
      Array.from(builders.entries()).map(async ([url, {auth, maxExecutionPayment}]): Promise<BuilderApiBid | null> => {
        this.metrics?.gloasBuilder.bidRequests.inc();
        try {
          const res = await this.getClientForUrl(url).getExecutionPayloadBid(
            {slot, parentHash, parentRoot, proposerPubkey, requestAuth: auth},
            {timeoutMs: BUILDER_BID_DELAY_TOLERANCE, headers: {"X-Timeout-Ms": String(BUILDER_BID_DELAY_TOLERANCE)}}
          );
          const signedBid = res.value();
          if (signedBid === undefined) {
            this.logger?.debug("No bid received from builder", {slot, builder: toPrintableUrl(url)});
            return null;
          }
          this.metrics?.gloasBuilder.bidsReceived.inc();
          return {url, maxExecutionPayment, signedBid};
        } catch (e) {
          this.metrics?.gloasBuilder.bidRequestErrors.inc();
          this.logger?.warn("Failed to get bid from builder", {slot, builder: toPrintableUrl(url)}, e as Error);
          return null;
        }
      })
    );

    return bids.filter((bid): bid is BuilderApiBid => bid !== null);
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
    try {
      (await this.getClientForUrl(url).submitSignedBeaconBlock({signedBlock}, {retries: 2})).assertOk();
      this.metrics?.gloasBuilder.blockSubmissions.inc({status: "success"});
    } catch (e) {
      this.metrics?.gloasBuilder.blockSubmissions.inc({status: "error"});
      throw e;
    }
  }

  recordBidSource(slot: Slot, source: BidSource): void {
    this.bidSourceBySlot.set(slot, source);
  }

  getBidSource(slot: Slot): BidSource | undefined {
    return this.bidSourceBySlot.get(slot);
  }

  prune(clockSlot: Slot): void {
    this.lowestPermissibleSlot = clockSlot;
    for (const slot of this.buildersByPubkeyBySlot.keys()) {
      if (slot < clockSlot) {
        this.buildersByPubkeyBySlot.delete(slot);
      }
    }
    for (const slot of this.bidSourceBySlot.keys()) {
      if (slot < clockSlot) {
        this.bidSourceBySlot.delete(slot);
      }
    }
  }

  private getClientForUrl(url: BuilderUrl): BuilderApi {
    let client = this.clients.get(url);
    if (client === undefined) {
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
