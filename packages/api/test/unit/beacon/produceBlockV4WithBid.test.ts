import {FastifyInstance} from "fastify";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {config} from "@lodestar/config/default";
import {ssz} from "@lodestar/types";
import {Endpoints, getDefinitions} from "../../../src/beacon/routes/validator.js";
import {getRoutes} from "../../../src/beacon/server/validator.js";
import {MetaHeader} from "../../../src/utils/metadata.js";
import {getMockApi, getTestServer} from "../../utils/utils.js";
import {testData} from "./testData/validator.js";

describe("produceBlockV4WithBid", () => {
  let server: FastifyInstance;
  const api = getMockApi<Endpoints>(testData);
  const definition = getDefinitions(config).produceBlockV4WithBid;

  beforeEach(() => {
    server = getTestServer().server;
    server.route(getRoutes(config, api).produceBlockV4WithBid);
  });

  afterEach(async () => {
    await server.close();
  });

  for (const format of ["json", "ssz"] as const) {
    describe(format, () => {
      function request() {
        const args = {...testData.produceBlockV4WithBid.args, includePayload: true};
        const req = format === "json" ? definition.req.writeReqJson(args) : definition.req.writeReqSsz(args);
        return {
          method: "POST" as const,
          url: `/eth/v4/validator/blocks/${args.slot}/with_bid`,
          query: Object.fromEntries(
            Object.entries(req.query)
              .filter(([, v]) => v !== undefined)
              .map(([k, v]) => [k, String(v)])
          ),
          headers: {
            ...req.headers,
            "content-type": format === "json" ? "application/json" : "application/octet-stream",
            accept: format === "json" ? "application/json" : "application/octet-stream",
          },
          payload: format === "json" ? JSON.stringify(req.body) : Buffer.from(req.body as Uint8Array),
        };
      }

      it("returns full block contents for a local payload", async () => {
        const data = ssz.gloas.BlockContents.defaultValue();
        api.produceBlockV4WithBid.mockResolvedValue({
          data,
          meta: {...testData.produceBlockV4WithBid.res.meta, executionPayloadIncluded: true},
        });
        const res = await server.inject(request());
        expect(res.statusCode).toBe(200);
        expect(res.headers[MetaHeader.ExecutionPayloadIncluded.toLowerCase()]).toBe("true");
        expect(
          format === "json"
            ? ssz.gloas.BlockContents.fromJson(res.json().data)
            : ssz.gloas.BlockContents.deserialize(new Uint8Array(res.rawPayload))
        ).toEqual(data);
      });

      it.each(["builder_boost_factor", "include_payload", "randao_reveal"])("requires %s", async (key) => {
        const req = request();
        delete req.query[key];
        const res = await server.inject(req);
        expect(res.statusCode).toBe(400);
        expect(api.produceBlockV4WithBid).not.toHaveBeenCalled();
      });

      it("requires the consensus version header", async () => {
        const req = request();
        const headers: Record<string, string> = {...req.headers};
        delete headers[MetaHeader.Version];
        const res = await server.inject({...req, headers});
        expect(res.statusCode).toBe(400);
        expect(api.produceBlockV4WithBid).not.toHaveBeenCalled();
      });

      it("rejects malformed bid bodies", async () => {
        const res = await server.inject({...request(), payload: format === "json" ? "{}" : Buffer.alloc(1)});
        expect(res.statusCode).toBe(400);
        expect(api.produceBlockV4WithBid).not.toHaveBeenCalled();
      });
    });
  }
});
