import {FastifyInstance} from "fastify";
import {afterAll, beforeAll, describe, expect, it} from "vitest";
import {toHexString} from "@chainsafe/ssz";
import {config} from "@lodestar/config/default";
import {ForkName} from "@lodestar/params";
import {getClient} from "../../../../src/beacon/client/lodestar.js";
import {Endpoints, FastConfirmationInfoType, getDefinitions} from "../../../../src/beacon/routes/lodestar.js";
import {getRoutes} from "../../../../src/beacon/server/lodestar.js";
import {HttpClient} from "../../../../src/utils/client/httpClient.js";
import {AnyEndpoint} from "../../../../src/utils/codecs.js";
import {FastifyRoute} from "../../../../src/utils/server/index.js";
import {WireFormat} from "../../../../src/utils/wireFormat.js";
import {getMockApi, getTestServer} from "../../../utils/utils.js";

const root = (fill: number): Uint8Array => new Uint8Array(32).fill(fill);

describe("beacon / lodestar", () => {
  describe("route responses", () => {
    const mockApi = getMockApi<Endpoints>(getDefinitions(config));
    let baseUrl: string;
    let server: FastifyInstance;

    beforeAll(async () => {
      const res = getTestServer();
      server = res.server;
      for (const route of Object.values(getRoutes(config, mockApi))) {
        server.route(route as FastifyRoute<AnyEndpoint>);
      }
      baseUrl = await res.start();
    });

    afterAll(async () => {
      if (server !== undefined) await server.close();
    });

    it("getFastConfirmationInfo", async () => {
      const data = {
        confirmed: {root: root(0xaa), slot: 100},
        head: {root: root(0xbb), slot: 102},
        justifiedCheckpoint: {root: root(0xcc), epoch: 3},
        finalizedCheckpoint: {root: root(0xdd), epoch: 2},
        previousEpochObservedJustifiedCheckpoint: {root: root(0xee), epoch: 2},
        currentEpochObservedJustifiedCheckpoint: {root: root(0xff), epoch: 3},
        previousEpochGreatestUnrealizedCheckpoint: {root: root(0x11), epoch: 2},
        previousSlotHead: root(0x22),
        currentSlotHead: root(0x33),
      };
      mockApi.getFastConfirmationInfo.mockResolvedValue({data});

      const httpClient = new HttpClient({baseUrl});
      const client = getClient(config, httpClient);

      const resJson = await client.getFastConfirmationInfo({responseWireFormat: WireFormat.json});

      expect(resJson.ok).toBe(true);
      expect(resJson.wireFormat()).toBe(WireFormat.json);
      expect(resJson.json().data).toStrictEqual({
        confirmed: {root: toHexString(root(0xaa)), slot: "100"},
        head: {root: toHexString(root(0xbb)), slot: "102"},
        justified_checkpoint: {root: toHexString(root(0xcc)), epoch: "3"},
        finalized_checkpoint: {root: toHexString(root(0xdd)), epoch: "2"},
        previous_epoch_observed_justified_checkpoint: {root: toHexString(root(0xee)), epoch: "2"},
        current_epoch_observed_justified_checkpoint: {root: toHexString(root(0xff)), epoch: "3"},
        previous_epoch_greatest_unrealized_checkpoint: {root: toHexString(root(0x11)), epoch: "2"},
        previous_slot_head: toHexString(root(0x22)),
        current_slot_head: toHexString(root(0x33)),
      });

      const resSsz = await client.getFastConfirmationInfo({responseWireFormat: WireFormat.ssz});

      expect(resSsz.ok).toBe(true);
      expect(resSsz.wireFormat()).toBe(WireFormat.ssz);
      expect(toHexString(resSsz.ssz())).toBe(toHexString(FastConfirmationInfoType.serialize(data)));
    });

    it("getHistoricalSummaries", async () => {
      const proof = [root(0xaa), root(0xbb), root(0xcc), root(0xdd), root(0xee)];
      const data = {
        slot: 1,
        historicalSummaries: [{blockSummaryRoot: root(0x01), stateSummaryRoot: root(0x02)}],
        proof,
      };
      const proofHex = proof.map((node) => toHexString(node));
      mockApi.getHistoricalSummaries.mockResolvedValue({
        data,
        meta: {version: ForkName.electra, executionOptimistic: false, finalized: false},
      });

      const httpClient = new HttpClient({baseUrl});
      const client = getClient(config, httpClient);

      const resJson = await client.getHistoricalSummaries({stateId: "head"}, {responseWireFormat: WireFormat.json});

      expect(resJson.ok).toBe(true);
      expect(resJson.wireFormat()).toBe(WireFormat.json);
      expect(resJson.json().data).toStrictEqual({
        slot: "1",
        historical_summaries: [
          {block_summary_root: toHexString(root(0x01)), state_summary_root: toHexString(root(0x02))},
        ],
        proof: proofHex,
      });
      expect(resJson.value().proof.map((node) => toHexString(node))).toStrictEqual(proofHex);

      const resSsz = await client.getHistoricalSummaries({stateId: "head"}, {responseWireFormat: WireFormat.ssz});

      expect(resSsz.ok, `status ${resSsz.status}: ${resSsz.error()?.message}`).toBe(true);
      expect(resSsz.wireFormat()).toBe(WireFormat.ssz);
      expect(resSsz.value().proof.map((node) => toHexString(node))).toStrictEqual(proofHex);
    });

    it("getHistoricalBlockRootProof", async () => {
      const proof = Array.from({length: 13}, (_, i) => root(0x10 + i));
      const data = {
        slot: 8192 * 3 + 5,
        blockRoot: root(0x01),
        historicalSummaryIndex: 3,
        blockSummaryRoot: root(0x02),
        proof,
      };
      const proofHex = proof.map((node) => toHexString(node));
      mockApi.getHistoricalBlockRootProof.mockResolvedValue({data, meta: {}});

      const httpClient = new HttpClient({baseUrl});
      const client = getClient(config, httpClient);

      const resJson = await client.getHistoricalBlockRootProof(
        {slot: data.slot},
        {responseWireFormat: WireFormat.json}
      );

      expect(resJson.ok).toBe(true);
      expect(resJson.wireFormat()).toBe(WireFormat.json);
      expect(resJson.json().data).toStrictEqual({
        slot: String(data.slot),
        block_root: toHexString(root(0x01)),
        historical_summary_index: "3",
        block_summary_root: toHexString(root(0x02)),
        proof: proofHex,
      });
      expect(mockApi.getHistoricalBlockRootProof).toHaveBeenCalledWith({slot: data.slot}, expect.anything());

      const resSsz = await client.getHistoricalBlockRootProof({slot: data.slot}, {responseWireFormat: WireFormat.ssz});

      expect(resSsz.ok, `status ${resSsz.status}: ${resSsz.error()?.message}`).toBe(true);
      expect(resSsz.wireFormat()).toBe(WireFormat.ssz);
      expect(resSsz.value().proof.map((node) => toHexString(node))).toStrictEqual(proofHex);
    });
  });
});
