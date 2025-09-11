import {config} from "@lodestar/config/default";
import {ForkName} from "@lodestar/params";
import {SignedBeaconBlock, ssz} from "@lodestar/types";
import {FastifyInstance} from "fastify";
import {afterAll, beforeAll, describe, expect, it} from "vitest";
import {getClient} from "../../../../src/beacon/client/lodestar.js";
import {
  AttesterSlashingListElectra,
  AttesterSlashingListTypeElectra,
} from "../../../../src/beacon/routes/beacon/pool.js";
import {Endpoints, getDefinitions} from "../../../../src/beacon/routes/lodestar.js";
import {getRoutes} from "../../../../src/beacon/server/lodestar.js";
import {HttpClient} from "../../../../src/utils/client/httpClient.js";
import {AnyEndpoint} from "../../../../src/utils/codecs.js";
import {FastifyRoute} from "../../../../src/utils/server/index.js";
import {WireFormat} from "../../../../src/utils/wireFormat.js";
import {getMockApi, getTestServer} from "../../../utils/utils.js";

describe("beacon / lodestar", () => {
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

  describe("get HistoricalSummaries as json", () => {
    it("getHistoricalSummaries", async () => {
      mockApi.getHistoricalSummaries.mockResolvedValue({
        data: {
          slot: 0,
          historicalSummaries: [],
          proof: [],
        },
        meta: {version: ForkName.electra, executionOptimistic: false, finalized: false},
      });

      const httpClient = new HttpClient({baseUrl});
      const client = getClient(config, httpClient);

      const res = await client.getHistoricalSummaries({stateId: "head"}, {responseWireFormat: WireFormat.json});

      expect(res.ok).toBe(true);
      expect(res.wireFormat()).toBe(WireFormat.json);
      expect(res.json().data).toStrictEqual({
        slot: "0",
        historical_summaries: [],
        proof: [],
      });
    });
  });
  describe("getAttesterSlashingsFromBlocks", () => {
    it("getAttesterSlashingsFromBlocks as json", async () => {
      const mockSignedBlocks: SignedBeaconBlock[] = [];
      mockSignedBlocks.push(ssz.electra.SignedBeaconBlock.defaultValue());

      // TODO: choose fork
      const attesterSlashingList: AttesterSlashingListElectra = [];
      // TODO: fails reading 'attestingIndices'
      //const attesterSlashing = ssz.electra.AttesterSlashing.defaultValue();
      //attesterSlashingList.push(attesterSlashing);

      const attesterSlashingsJson = attesterSlashingList.map((slashing) =>
        ssz.electra.AttesterSlashing.toJson(slashing)
      );

      const mockReturnValue = {
        data: attesterSlashingsJson as AttesterSlashingListElectra,
      };

      mockApi.getAttesterSlashingsFromBlocks.mockResolvedValue(mockReturnValue);

      const httpClient = new HttpClient({baseUrl});
      const client = getClient(config, httpClient);

      const res = await client.getAttesterSlashingsFromBlocks(
        {signedBlocks: mockSignedBlocks},
        {
          requestWireFormat: WireFormat.json,
          responseWireFormat: WireFormat.json,
        }
      );

      expect(res.ok).toBe(true);
      expect(res.wireFormat()).toBe(WireFormat.json);
      expect(res.json().data).toStrictEqual(attesterSlashingsJson);
    });
    it("getAttesterSlashingsFromBlocks as ssz", async () => {
      const mockSignedBlocks: SignedBeaconBlock[] = [];
      mockSignedBlocks.push(ssz.electra.SignedBeaconBlock.defaultValue());

      // TODO: choose fork
      const attesterSlashingList: AttesterSlashingListElectra = [];

      const attesterSlashing = ssz.electra.AttesterSlashing.defaultValue();
      attesterSlashingList.push(attesterSlashing);

      const attesterSlashingsSsz = AttesterSlashingListTypeElectra.serialize(attesterSlashingList);

      const mockReturnValue = {
        data: attesterSlashingsSsz as Uint8Array,
      };

      mockApi.getAttesterSlashingsFromBlocks.mockResolvedValue(mockReturnValue);

      const httpClient = new HttpClient({baseUrl});
      const client = getClient(config, httpClient);

      const res = await client.getAttesterSlashingsFromBlocks(
        {signedBlocks: mockSignedBlocks},
        {
          requestWireFormat: WireFormat.ssz,
          responseWireFormat: WireFormat.ssz,
        }
      );

      expect(res.ok).toBe(true);
      expect(res.wireFormat()).toBe(WireFormat.ssz);
      expect(res.ssz()).toStrictEqual(attesterSlashingsSsz);
    });
  });
});
