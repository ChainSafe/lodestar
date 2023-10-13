import {describe, it, expect, beforeEach} from "vitest";
import chai from "chai";
import sinon from "sinon";
import sinonChai from "sinon-chai";
import {Api} from "@lodestar/api";
import {hash} from "@lodestar/utils";
import {Logger} from "@lodestar/logger";
import {allForks, capella} from "@lodestar/types";
import {toHexString} from "@lodestar/utils";
import {PayloadStore} from "../../../src/proof_provider/payload_store.js";
import {MAX_PAYLOAD_HISTORY} from "../../../src/constants.js";

chai.use(sinonChai);

const createHash = (input: string): Uint8Array => hash(Buffer.from(input, "utf8"));

const buildPayload = ({blockNumber}: {blockNumber: number}): allForks.ExecutionPayload =>
  ({
    blockNumber,
    blockHash: createHash(`"block-hash-${blockNumber}`),
    parentHash: createHash(`"parent-hash-${blockNumber}`),
  }) as unknown as allForks.ExecutionPayload;

const buildLCHeader = ({slot, blockNumber}: {slot: number; blockNumber: number}): capella.LightClientHeader =>
  ({
    beacon: {slot, stateRoot: createHash(`"beacon-state-root-${slot}`)},
    execution: buildPayload({blockNumber}),
  }) as unknown as capella.LightClientHeader;

const buildBlock = ({slot, blockNumber}: {slot: number; blockNumber: number}): allForks.SignedBeaconBlock =>
  ({
    signature: createHash(`"beacon-block-signature-${slot}`),
    message: {
      slot,
      proposerIndex: 0,
      parentRoot: createHash(`"beacon-parent-root-${slot}`),
      stateRoot: createHash(`"beacon-state-root-${slot}`),
      body: {
        executionPayload: buildPayload({blockNumber}),
      },
    },
  }) as unknown as allForks.SignedBeaconBlock;

const buildBlockResponse = ({
  slot,
  blockNumber,
}: {
  slot: number;
  blockNumber: number;
}): {ok: boolean; response: {version: number; executionOptimistic: boolean; data: allForks.SignedBeaconBlock}} => ({
  ok: true,
  response: {
    version: 12,
    executionOptimistic: true,
    data: buildBlock({slot, blockNumber}),
  },
});

describe("proof_provider/payload_store", function () {
  let api: Api;
  let logger: Logger;
  let store: PayloadStore;

  beforeEach(() => {
    api = {beacon: {getBlockV2: sinon.stub()}} as unknown as Api;
    logger = console as unknown as Logger;
    store = new PayloadStore({api, logger});
  });

  describe("finalized", () => {
    it("should return undefined for an empty store", () => {
      expect(store.finalized).to.undefined;
    });

    it("should return undefined if no finalized block", () => {
      store.set(buildPayload({blockNumber: 10}), false);

      expect(store.finalized).to.undefined;
    });

    it("should return finalized payload", () => {
      const payload = buildPayload({blockNumber: 10});
      store.set(payload, true);

      expect(store.finalized).toEqual(payload);
    });

    it("should return highest finalized payload", () => {
      const payload1 = buildPayload({blockNumber: 10});
      const payload2 = buildPayload({blockNumber: 11});
      store.set(payload1, true);
      store.set(payload2, true);

      expect(store.finalized).toEqual(payload2);
    });
  });

  describe("latest", () => {
    it("should return undefined for an empty store", () => {
      expect(store.latest).to.undefined;
    });

    it("should return latest payload if finalized", () => {
      const payload1 = buildPayload({blockNumber: 10});
      const payload2 = buildPayload({blockNumber: 11});
      store.set(payload1, true);
      store.set(payload2, true);

      expect(store.latest).toEqual(payload2);
    });

    it("should return latest payload if not finalized", () => {
      const payload1 = buildPayload({blockNumber: 10});
      const payload2 = buildPayload({blockNumber: 11});
      store.set(payload1, false);
      store.set(payload2, false);

      expect(store.latest).toEqual(payload2);
    });
  });

  describe("get", () => {
    it("should return undefined for an empty store", async () => {
      await expect(store.get(10)).resolves.toBeUndefined();
    });

    it("should return undefined for non existing block id", async () => {
      const payload1 = buildPayload({blockNumber: 10});
      store.set(payload1, false);

      await expect(store.get(11)).resolves.toBeUndefined();
    });

    it("should return undefined for non existing block hash", async () => {
      const payload1 = buildPayload({blockNumber: 10});
      store.set(payload1, false);
      const nonExistingBlockHash = createHash("non-existing-block-hash");

      await expect(store.get(toHexString(nonExistingBlockHash))).resolves.toBeUndefined();
    });

    describe("block hash as blockId", () => {
      it("should return payload for a block hash", async () => {
        const payload1 = buildPayload({blockNumber: 10});
        store.set(payload1, false);

        await expect(store.get(toHexString(payload1.blockHash))).resolves.toEqual(payload1);
      });
    });

    describe("block number as blockId", () => {
      it("should throw error to use block hash for un-finalized blocks", async () => {
        const finalizedPayload = buildPayload({blockNumber: 10});
        store.set(finalizedPayload, true);

        await expect(store.get(11)).rejects.toThrow(
          "Block number 11 is higher than the latest finalized block number. We recommend to use block hash for unfinalized blocks."
        );
      });

      it("should return undefined if payload exists but not-finalized", async () => {
        const payload1 = buildPayload({blockNumber: 10});
        store.set(payload1, false);

        await expect(store.get(10)).resolves.toBeUndefined();
      });

      it("should return payload for a block number in hex", async () => {
        const payload1 = buildPayload({blockNumber: 10});
        store.set(payload1, true);

        await expect(store.get(`0x${payload1.blockNumber.toString(16)}`)).resolves.toEqual(payload1);
      });

      it("should return payload for a block number as string", async () => {
        const payload1 = buildPayload({blockNumber: 10});
        store.set(payload1, true);

        await expect(store.get(payload1.blockNumber.toString())).resolves.toEqual(payload1);
      });

      it("should return payload for a block number as integer", async () => {
        const payload1 = buildPayload({blockNumber: 10});
        store.set(payload1, true);

        await expect(store.get(10)).resolves.toEqual(payload1);
      });

      it("should fetch the finalized payload from API if payload root not exists", async () => {
        const blockNumber = 10;
        // It should be less than the finalized block to considered as finalized
        const unavailableBlockNumber = 9;
        const availablePayload = buildPayload({blockNumber});
        const unavailablePayload = buildPayload({blockNumber: unavailableBlockNumber});

        (api.beacon.getBlockV2 as sinon.SinonStub)
          .withArgs(blockNumber)
          .resolves(buildBlockResponse({blockNumber, slot: blockNumber}));

        (api.beacon.getBlockV2 as sinon.SinonStub)
          .withArgs(unavailableBlockNumber)
          .resolves(buildBlockResponse({blockNumber: unavailableBlockNumber, slot: unavailableBlockNumber}));

        store.set(availablePayload, true);

        const result = await store.get(unavailablePayload.blockNumber);

        expect(api.beacon.getBlockV2 as sinon.SinonStub).calledTwice;
        expect(api.beacon.getBlockV2 as sinon.SinonStub).calledWith(blockNumber);
        expect(api.beacon.getBlockV2 as sinon.SinonStub).calledWith(unavailableBlockNumber);
        expect(result).toEqual(unavailablePayload);
      });
    });
  });

  describe("set", () => {
    it("should set the payload for non-finalized blocks", async () => {
      const payload1 = buildPayload({blockNumber: 10});
      store.set(payload1, false);

      // Unfinalized blocks are not indexed by block hash
      await expect(store.get(toHexString(payload1.blockHash))).resolves.toEqual(payload1);
      expect(store.finalized).toEqual(undefined);
    });

    it("should set the payload for finalized blocks", async () => {
      const payload1 = buildPayload({blockNumber: 10});
      store.set(payload1, true);

      await expect(store.get(payload1.blockNumber.toString())).resolves.toEqual(payload1);
      expect(store.finalized).toEqual(payload1);
    });
  });

  describe("processLCHeader", () => {
    describe("unfinalized header", () => {
      it("should process lightclient header for un-finalized block", () => {});
    });

    describe("finalized header", () => {
      it("should process lightclient header for finalized block which does not exists in store", async () => {
        const blockNumber = 10;
        const slot = 20;
        const header = buildLCHeader({slot, blockNumber});
        const blockResponse = buildBlockResponse({blockNumber, slot});
        const executionPayload = (blockResponse.response.data as capella.SignedBeaconBlock).message.body
          .executionPayload;
        (api.beacon.getBlockV2 as sinon.SinonStub).resolves(blockResponse);

        await store.processLCHeader(header, true);

        expect(api.beacon.getBlockV2).calledOnce;
        expect(api.beacon.getBlockV2).calledWith(20);
        expect(store.finalized).toEqual(executionPayload);
      });

      it("should process lightclient header for finalized block which exists as un-finalized in store", async () => {
        const blockNumber = 10;
        const slot = 20;
        const header = buildLCHeader({slot, blockNumber});
        const blockResponse = buildBlockResponse({blockNumber, slot});
        const executionPayload = (blockResponse.response.data as capella.SignedBeaconBlock).message.body
          .executionPayload;
        (api.beacon.getBlockV2 as sinon.SinonStub).resolves(blockResponse);

        expect(store.finalized).to.undefined;
        // First process as unfinalized
        await store.processLCHeader(header, false);

        // Then process as finalized
        await store.processLCHeader(header, true);

        // Called only once when we process unfinalized
        expect(api.beacon.getBlockV2).to.be.calledOnce;
        expect(store.finalized).toEqual(executionPayload);
      });
    });

    it("should fetch non-existing payload for lightclient header", async () => {
      const blockNumber = 10;
      const slot = 20;
      const header = buildLCHeader({slot, blockNumber});
      (api.beacon.getBlockV2 as sinon.SinonStub).resolves(buildBlockResponse({blockNumber, slot}));

      await store.processLCHeader(header);

      expect(api.beacon.getBlockV2).calledOnce;
      expect(api.beacon.getBlockV2).calledWith(20);
    });

    it("should not fetch existing payload for lightclient header", async () => {
      const blockNumber = 10;
      const slot = 20;
      const header = buildLCHeader({slot, blockNumber});
      (api.beacon.getBlockV2 as sinon.SinonStub).resolves(buildBlockResponse({blockNumber, slot}));

      await store.processLCHeader(header);

      // Process same header twice
      await store.processLCHeader(header);

      // The network fetch should be done once
      expect(api.beacon.getBlockV2).calledOnce;
      expect(api.beacon.getBlockV2).calledWith(20);
    });

    it("should prune the existing payloads", async () => {
      const blockNumber = 10;
      const slot = 20;
      const header = buildLCHeader({slot, blockNumber});
      (api.beacon.getBlockV2 as sinon.SinonStub).resolves(buildBlockResponse({blockNumber, slot}));

      sinon.spy(store, "prune");

      await store.processLCHeader(header);

      expect(store.prune).to.be.calledOnce;
    });
  });

  describe("prune", () => {
    it("should prune without error for empty store", () => {
      expect(() => store.prune()).not.to.throw;
    });

    it("should prune the existing payloads if larger than MAX_PAYLOAD_HISTORY", () => {
      const numberOfPayloads = MAX_PAYLOAD_HISTORY + 2;

      for (let i = 1; i <= numberOfPayloads; i++) {
        store.set(buildPayload({blockNumber: i}), true);
      }

      expect(store["payloads"].size).toEqual(numberOfPayloads);

      store.prune();

      expect(store["payloads"].size).toEqual(MAX_PAYLOAD_HISTORY);
    });

    it("should not prune the existing payloads if equal to MAX_PAYLOAD_HISTORY", () => {
      const numberOfPayloads = MAX_PAYLOAD_HISTORY;

      for (let i = 1; i <= numberOfPayloads; i++) {
        store.set(buildPayload({blockNumber: i}), true);
      }

      expect(store["payloads"].size).toEqual(MAX_PAYLOAD_HISTORY);

      store.prune();

      expect(store["payloads"].size).toEqual(MAX_PAYLOAD_HISTORY);
    });

    it("should not prune the existing payloads if less than MAX_PAYLOAD_HISTORY", () => {
      const numberOfPayloads = MAX_PAYLOAD_HISTORY - 1;

      for (let i = 1; i <= numberOfPayloads; i++) {
        store.set(buildPayload({blockNumber: i}), true);
      }

      expect(store["payloads"].size).toEqual(numberOfPayloads);

      store.prune();

      expect(store["payloads"].size).toEqual(numberOfPayloads);
    });

    it("should prune finalized roots", () => {
      const numberOfPayloads = MAX_PAYLOAD_HISTORY + 2;

      for (let i = 1; i <= numberOfPayloads; i++) {
        store.set(buildPayload({blockNumber: i}), true);
      }

      expect(store["finalizedRoots"].size).toEqual(numberOfPayloads);

      store.prune();

      expect(store["finalizedRoots"].size).toEqual(MAX_PAYLOAD_HISTORY);
    });

    it("should prune unfinalized roots", async () => {
      const numberOfPayloads = MAX_PAYLOAD_HISTORY + 2;

      for (let i = 1; i <= numberOfPayloads; i++) {
        (api.beacon.getBlockV2 as sinon.SinonStub)
          .withArgs(i)
          .resolves(buildBlockResponse({blockNumber: 500 + i, slot: i}));

        await store.processLCHeader(buildLCHeader({blockNumber: 500 + i, slot: i}), false);
      }

      // Because all payloads are unfinalized, they are not pruned
      expect(store["unfinalizedRoots"].size).toEqual(numberOfPayloads);

      // Let make some payloads finalized
      await store.processLCHeader(buildLCHeader({blockNumber: 500 + 1, slot: 1}), true);
      await store.processLCHeader(buildLCHeader({blockNumber: 500 + 2, slot: 2}), true);

      // store.processLCHeader will call the prune method internally and clean the unfinalized roots
      expect(store["unfinalizedRoots"].size).toEqual(numberOfPayloads - 2);
    });
  });
});
