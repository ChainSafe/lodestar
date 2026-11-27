import {Mock, beforeEach, describe, expect, it, vi} from "vitest";
import {createBeaconConfig} from "@lodestar/config";
import {getConfig} from "@lodestar/config/test-utils";
import {SecretKey} from "@lodestar/native/blst";
import {DOMAIN_BEACON_PROPOSER, DOMAIN_BUILDER_REQUEST_AUTH, ForkName} from "@lodestar/params";
import {ZERO_HASH, computeDomain, computeSigningRoot} from "@lodestar/state-transition";
import {gloas, ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {BuilderApi, getBuilderApi} from "../../../src/api/impl.js";
import {BidRequestResult, Metrics} from "../../../src/metrics.js";
import {BidLedger} from "../../../src/services/bidLedger.js";
import {ProposerDutiesTracker} from "../../../src/services/proposerDutiesTracker.js";
import {getApiClientStub, mockApiErrorResponse, mockApiResponse} from "../utils/apiStub.js";
import {ClockMock} from "../utils/clock.js";
import {getMockedLogger} from "../utils/logger.js";

const slot = 3;
const builderIndex = 1;
const proposerIndex = 7;
const authData = new TextEncoder().encode("builder.example.com");
const parentHash = Buffer.alloc(32, 4);
const parentRoot = Buffer.alloc(32, 5);
const config = createBeaconConfig(getConfig(ForkName.gloas), Buffer.alloc(32, 0xaa));
const proposerKey = SecretKey.fromBytes(Buffer.alloc(32, 2));
const proposerPubkey = proposerKey.toPublicKey().toBytes();
const otherKey = SecretKey.fromBytes(Buffer.alloc(32, 3));

describe("builder api", () => {
  let api: ReturnType<typeof getApiClientStub>;
  let clock: ClockMock;
  let ledger: BidLedger;
  let builderApi: BuilderApi;
  let signedBid: gloas.SignedExecutionPayloadBid;
  let bidRequests: Mock;
  let blockSubmissions: Mock;

  beforeEach(() => {
    api = getApiClientStub();
    api.validator.getProposerDutiesV2.mockResolvedValue(
      mockApiResponse({
        // The same validator proposes the next slot, a request is then only bound to its slot by the checks of the API
        data: [
          {slot, validatorIndex: proposerIndex, pubkey: proposerPubkey},
          {slot: slot + 1, validatorIndex: proposerIndex, pubkey: proposerPubkey},
        ],
        meta: {executionOptimistic: false, dependentRoot: "0x00"},
      })
    );
    api.beacon.publishBlockV2.mockResolvedValue(mockApiResponse({}));
    clock = new ClockMock();
    clock.currentSlot = slot;
    ledger = new BidLedger();
    const logger = getMockedLogger();
    bidRequests = vi.fn();
    blockSubmissions = vi.fn();
    const metrics = {
      api: {bidRequests: {inc: bidRequests}, blockSubmissions: {inc: blockSubmissions}},
    } as unknown as Metrics;
    builderApi = getBuilderApi(
      {
        config,
        logger,
        clock,
        api,
        ledger,
        proposerDutiesTracker: new ProposerDutiesTracker(api, clock, logger),
        builderIndex,
        metrics,
      },
      {authData}
    );

    signedBid = ssz.gloas.SignedExecutionPayloadBid.defaultValue();
    signedBid.message.slot = slot;
    signedBid.message.builderIndex = builderIndex;
    signedBid.message.parentBlockHash = parentHash;
    signedBid.message.parentBlockRoot = parentRoot;
    signedBid.message.blockHash = Buffer.alloc(32, 6);
    signedBid.message.value = 5;
    ledger.recordBid({
      signedBid,
      signedBidRoot: toRootHex(ssz.gloas.SignedExecutionPayloadBid.hashTreeRoot(signedBid)),
    });
  });

  function signAuth(
    message: gloas.BuilderRequestAuth = {data: authData, slot},
    secretKey = proposerKey
  ): gloas.SignedBuilderRequestAuth {
    const domain = computeDomain(DOMAIN_BUILDER_REQUEST_AUTH, config.GENESIS_FORK_VERSION, ZERO_HASH);
    const signingRoot = computeSigningRoot(ssz.gloas.BuilderRequestAuth, message, domain);
    return {message, signature: secretKey.sign(signingRoot).toBytes()};
  }

  function bidRequest(overrides: Partial<Parameters<BuilderApi["getExecutionPayloadBid"]>[0]> = {}) {
    return {
      slot,
      parentHash,
      parentRoot,
      proposerPubkey,
      requestAuth: signAuth(),
      dateMilliseconds: 0,
      timeoutMs: 500,
      ...overrides,
    };
  }

  function signBlock(secretKey = proposerKey, blockProposerIndex = proposerIndex): gloas.SignedBeaconBlock {
    const block = ssz.gloas.SignedBeaconBlock.defaultValue();
    block.message.slot = slot;
    block.message.proposerIndex = blockProposerIndex;
    block.message.body.signedExecutionPayloadBid = signedBid;
    const domain = config.getDomain(slot, DOMAIN_BEACON_PROPOSER);
    const signingRoot = computeSigningRoot(ssz.gloas.BeaconBlock, block.message, domain);
    block.signature = secretKey.sign(signingRoot).toBytes();
    return block;
  }

  describe("getExecutionPayloadBid", () => {
    it("returns the published bid of the requested slot and parent", async () => {
      const response = await builderApi.getExecutionPayloadBid(bidRequest());

      expect(response).toEqual({data: signedBid, meta: {version: ForkName.gloas}});
      expect(bidRequests).toHaveBeenCalledExactlyOnceWith({result: BidRequestResult.served});
    });

    it("returns no content if there is no bid on the requested parent", async () => {
      const response = await builderApi.getExecutionPayloadBid(bidRequest({parentHash: Buffer.alloc(32, 9)}));

      expect(response).toEqual({data: undefined, meta: {version: ForkName.gloas}, status: 204});
      expect(bidRequests).toHaveBeenCalledExactlyOnceWith({result: BidRequestResult.noBid});
    });

    it("serves a bid for two slots after its slot", async () => {
      clock.currentSlot = slot + 2;
      expect(await builderApi.getExecutionPayloadBid(bidRequest())).toEqual({
        data: signedBid,
        meta: {version: ForkName.gloas},
      });

      clock.currentSlot = slot + 3;
      expect(await builderApi.getExecutionPayloadBid(bidRequest())).toEqual({
        data: undefined,
        meta: {version: ForkName.gloas},
        status: 204,
      });
    });

    it.each([
      {id: "auth for another slot", requestAuth: signAuth({data: authData, slot: slot + 1}), statusCode: 400},
      {
        id: "auth data not agreed with the builder",
        requestAuth: signAuth({data: new TextEncoder().encode("other.example.com"), slot}),
        statusCode: 400,
      },
      {id: "auth signed by another key", requestAuth: signAuth(undefined, otherKey), statusCode: 401},
      {id: "malformed auth signature", requestAuth: {...signAuth(), signature: Buffer.alloc(96, 1)}, statusCode: 401},
    ])("rejects $id", async ({requestAuth, statusCode}) => {
      await expect(builderApi.getExecutionPayloadBid(bidRequest({requestAuth}))).rejects.toMatchObject({statusCode});
      expect(bidRequests).toHaveBeenCalledExactlyOnceWith({result: BidRequestResult.rejected});
    });

    it("does not count a request as rejected if the proposer duties cannot be fetched", async () => {
      api.validator.getProposerDutiesV2.mockRejectedValue(new Error("beacon node unavailable"));

      await expect(builderApi.getExecutionPayloadBid(bidRequest())).rejects.toThrow("beacon node unavailable");
      expect(bidRequests).not.toHaveBeenCalled();
    });

    it("rejects a requester that is not the proposer of the slot", async () => {
      const request = bidRequest({
        proposerPubkey: otherKey.toPublicKey().toBytes(),
        requestAuth: signAuth(undefined, otherKey),
      });

      await expect(builderApi.getExecutionPayloadBid(request)).rejects.toMatchObject({statusCode: 400});
    });
  });

  describe("submitBuilderPreferences", () => {
    it("accepts preferences of the proposer of a slot", async () => {
      const response = await builderApi.submitBuilderPreferences({
        proposerPubkey,
        request: {preferences: {maxExecutionPayment: 1n}, auth: signAuth()},
      });

      expect(response).toEqual({status: 202});
    });

    it("rejects preferences for a slot that has passed", async () => {
      clock.currentSlot = slot + 1;

      await expect(
        builderApi.submitBuilderPreferences({
          proposerPubkey,
          request: {preferences: {maxExecutionPayment: 1n}, auth: signAuth()},
        })
      ).rejects.toMatchObject({statusCode: 400});
    });

    it("rejects preferences with an invalid signature", async () => {
      await expect(
        builderApi.submitBuilderPreferences({
          proposerPubkey,
          request: {preferences: {maxExecutionPayment: 1n}, auth: signAuth(undefined, otherKey)},
        })
      ).rejects.toMatchObject({statusCode: 401});
    });
  });

  describe("submitSignedBeaconBlock", () => {
    it("publishes a block that commits to one of our bids", async () => {
      const block = signBlock();

      const response = await builderApi.submitSignedBeaconBlock({signedBlock: {data: block}});

      expect(response).toEqual({status: 202});
      expect(api.beacon.publishBlockV2).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({signedBlockContents: {signedBlock: block}})
      );
      expect(blockSubmissions).toHaveBeenCalledOnce();
    });

    it("rejects a block that commits to the bid of another builder", async () => {
      const block = signBlock();
      block.message.body.signedExecutionPayloadBid = {
        ...signedBid,
        message: {...signedBid.message, builderIndex: builderIndex + 1},
      };

      await expect(builderApi.submitSignedBeaconBlock({signedBlock: {data: block}})).rejects.toMatchObject({
        statusCode: 400,
      });
      expect(api.beacon.publishBlockV2).not.toHaveBeenCalled();
    });

    it("rejects a block that commits to a bid we did not publish", async () => {
      const block = signBlock();
      block.message.body.signedExecutionPayloadBid = {
        ...signedBid,
        message: {...signedBid.message, blockHash: Buffer.alloc(32, 9)},
      };

      await expect(builderApi.submitSignedBeaconBlock({signedBlock: {data: block}})).rejects.toMatchObject({
        statusCode: 400,
      });
      expect(api.beacon.publishBlockV2).not.toHaveBeenCalled();
    });

    it.each([
      {id: "value", message: {value: 6}},
      {id: "fee recipient", message: {feeRecipient: Buffer.alloc(20, 9)}},
    ])("rejects a block that keeps the block hash of our bid but changes its $id", async ({message}) => {
      const block = signBlock();
      block.message.body.signedExecutionPayloadBid = {...signedBid, message: {...signedBid.message, ...message}};

      await expect(builderApi.submitSignedBeaconBlock({signedBlock: {data: block}})).rejects.toMatchObject({
        statusCode: 400,
      });
      expect(api.beacon.publishBlockV2).not.toHaveBeenCalled();
    });

    it("rejects a block that changes the signature of our bid", async () => {
      const block = signBlock();
      block.message.body.signedExecutionPayloadBid = {...signedBid, signature: Buffer.alloc(96, 9)};

      await expect(builderApi.submitSignedBeaconBlock({signedBlock: {data: block}})).rejects.toMatchObject({
        statusCode: 400,
      });
      expect(api.beacon.publishBlockV2).not.toHaveBeenCalled();
    });

    it("rejects a block the beacon node rejects with the status of an invalid block", async () => {
      api.beacon.publishBlockV2.mockResolvedValue(await mockApiErrorResponse(400, {message: "invalid block"}));

      await expect(builderApi.submitSignedBeaconBlock({signedBlock: {data: signBlock()}})).rejects.toMatchObject({
        statusCode: 400,
      });
      expect(blockSubmissions).not.toHaveBeenCalled();
    });

    it("does not report a failure of the beacon node as an invalid block", async () => {
      api.beacon.publishBlockV2.mockResolvedValue(await mockApiErrorResponse(503, {message: "node is syncing"}));

      await expect(builderApi.submitSignedBeaconBlock({signedBlock: {data: signBlock()}})).rejects.toMatchObject({
        status: 503,
      });
    });

    it("accepts a block that was already published without processing it again", async () => {
      const block = signBlock();
      await builderApi.submitSignedBeaconBlock({signedBlock: {data: block}});

      const response = await builderApi.submitSignedBeaconBlock({signedBlock: {data: block}});

      expect(response).toEqual({status: 202});
      expect(api.beacon.publishBlockV2).toHaveBeenCalledOnce();
      expect(blockSubmissions).toHaveBeenCalledOnce();
    });

    it("processes a block again that the beacon node did not accept", async () => {
      const block = signBlock();
      api.beacon.publishBlockV2.mockResolvedValueOnce(await mockApiErrorResponse(503, {message: "node is syncing"}));
      await expect(builderApi.submitSignedBeaconBlock({signedBlock: {data: block}})).rejects.toMatchObject({
        status: 503,
      });

      const response = await builderApi.submitSignedBeaconBlock({signedBlock: {data: block}});

      expect(response).toEqual({status: 202});
      expect(api.beacon.publishBlockV2).toHaveBeenCalledTimes(2);
    });

    it("rejects a block that commits to a bid that is no longer served", async () => {
      clock.currentSlot = slot + 3;

      await expect(builderApi.submitSignedBeaconBlock({signedBlock: {data: signBlock()}})).rejects.toMatchObject({
        statusCode: 400,
      });
      expect(api.beacon.publishBlockV2).not.toHaveBeenCalled();
    });

    it("rejects a block with the index of another validator that is signed by the proposer of the slot", async () => {
      const block = signBlock(proposerKey, proposerIndex + 1);

      await expect(builderApi.submitSignedBeaconBlock({signedBlock: {data: block}})).rejects.toMatchObject({
        statusCode: 400,
      });
      expect(api.beacon.publishBlockV2).not.toHaveBeenCalled();
    });

    it("rejects a block that is not signed by the proposer of the slot", async () => {
      await expect(
        builderApi.submitSignedBeaconBlock({signedBlock: {data: signBlock(otherKey)}})
      ).rejects.toMatchObject({statusCode: 400});
      expect(api.beacon.publishBlockV2).not.toHaveBeenCalled();
    });
  });
});
