import {describe, expect, it} from "vitest";
import {RouteDefinitionExtra} from "../../../src/utils/client/request.js";
import {ApiResponse} from "../../../src/utils/client/response.js";
import {Endpoint} from "../../../src/utils/types.js";

describe("ApiResponse", () => {
  const definition = {operationId: "submitBatch"} as unknown as RouteDefinitionExtra<Endpoint>;

  async function errorResponse(body: unknown, status = 400): Promise<ApiResponse<Endpoint>> {
    const res = new ApiResponse(definition, typeof body === "string" ? body : JSON.stringify(body), {status});
    await res.errorBody();
    return res;
  }

  it("exposes the failures of a batch request on the error", async () => {
    const failures = [
      {index: 1, message: "invalid signature"},
      {index: 3, message: "unknown dependent root"},
    ];
    const err = (await errorResponse({code: 400, message: "Error processing batch", failures})).error();

    expect(err?.status).toBe(400);
    expect(err?.failures).toEqual(failures);
    expect(err?.message).toBe(
      "submitBatch failed with status 400: Error processing batch\ninvalid signature\nunknown dependent root"
    );
  });

  it("does not set failures for a plain error", async () => {
    const err = (await errorResponse({code: 400, message: "Invalid request"})).error();

    expect(err?.failures).toBeUndefined();
    expect(err?.message).toBe("submitBatch failed with status 400: Invalid request");
  });

  it("falls back to the raw body for a non-json error", async () => {
    const err = (await errorResponse("Internal Server Error", 500)).error();

    expect(err?.failures).toBeUndefined();
    expect(err?.message).toBe("submitBatch failed with status 500: Internal Server Error");
  });
});
