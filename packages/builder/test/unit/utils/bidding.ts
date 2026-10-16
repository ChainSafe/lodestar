import {vi} from "vitest";
import {ApiClient} from "@lodestar/api";
import {ChainForkConfig} from "@lodestar/config";
import {IClock} from "@lodestar/state-transition";
import {BuilderIndex, BuilderStatus} from "@lodestar/types";
import {Logger} from "@lodestar/utils";
import {Bidder} from "../../../src/services/bidder.js";
import {BidLedger} from "../../../src/services/bidLedger.js";
import {ProportionalBidPolicy} from "../../../src/services/bidPolicy.js";
import {BidPublisher} from "../../../src/services/bidPublisher.js";
import {BidSelector} from "../../../src/services/bidSelector.js";
import {BuilderSigner} from "../../../src/services/builderSigner.js";
import {EnvelopePublisher} from "../../../src/services/envelopePublisher.js";
import {PayloadOrchestrator} from "../../../src/services/payloadOrchestrator.js";
import {PayloadSource} from "../../../src/services/payloadSource.js";
import {PayloadStore} from "../../../src/services/payloadStore.js";
import {ProposerPreferencesTracker} from "../../../src/services/proposerPreferencesTracker.js";
import {Revealer} from "../../../src/services/revealer.js";

export const biddingOptions = {
  shareBps: 9000,
  fixedCostGwei: 0,
  minValueGwei: 0,
  deadlineBps: 8500,
  getPayloadTimeout: 1000,
  minOperatingBalanceGwei: 1_100_000_000,
};

export function getPayloadSourceStub() {
  return {
    id: "el",
    prepare: vi.fn<PayloadSource["prepare"]>(),
    getPayload: vi.fn<PayloadSource["getPayload"]>(),
  };
}

export function createBiddingModules({
  api,
  config,
  logger,
  clock,
  builderSigner,
  proposerPreferencesTracker,
  payloadStore,
  payloadSource,
  signal,
  index = 1,
  getBuilderStatus = () => ({status: "active", balance: 10_000_000_000}),
}: {
  api: ApiClient;
  config: ChainForkConfig;
  logger: Logger;
  clock: IClock;
  builderSigner: BuilderSigner;
  proposerPreferencesTracker: ProposerPreferencesTracker;
  payloadStore: PayloadStore;
  payloadSource: PayloadSource;
  signal: AbortSignal;
  index?: BuilderIndex;
  getBuilderStatus?: () => {status: BuilderStatus | undefined; balance: number | undefined};
}): {ledger: BidLedger; bidder: Bidder; revealer: Revealer} {
  const ledger = new BidLedger();
  const bidder = new Bidder(
    {
      config,
      logger,
      clock,
      api,
      orchestrator: new PayloadOrchestrator(
        payloadSource,
        {getPayloadTimeout: biddingOptions.getPayloadTimeout},
        signal
      ),
      payloadStore,
      ledger,
      policy: new ProportionalBidPolicy(biddingOptions),
      bidPublisher: new BidPublisher({
        api,
        config,
        signer: builderSigner,
        ledger,
        builderIndex: index,
        hasPayload: ({blockHash}) => payloadStore.has(blockHash),
      }),
      proposerPreferencesTracker,
      getBuilderStatus,
      builderIndex: index,
      executionFeeRecipient: Buffer.alloc(20, 9),
      metrics: null,
      signal,
    },
    biddingOptions
  );
  const revealer = new Revealer(
    {
      config,
      logger,
      clock,
      bidSelector: new BidSelector({config, ledger, builderIndex: index}),
      payloadStore,
      envelopePublisher: new EnvelopePublisher({api, signer: builderSigner, ledger, builderIndex: index}),
      builderIndex: index,
      metrics: null,
      signal,
    },
    {cutoffBps: config.PAYLOAD_ATTESTATION_DUE_BPS}
  );
  return {ledger, bidder, revealer};
}
