import {afterEach, describe, expect, it} from "vitest";
import {RestApiServer} from "../../../../src/api/rest/base.js";
import {GossipAction, GossipActionError} from "../../../../src/chain/errors/gossipValidation.js";
import {getMockedLogger} from "../../../mocks/loggerMock.js";

class TestRestApiServer extends RestApiServer {
  registerErrorRoute(error: Error): void {
    this.server.get("/error", async () => {
      throw error;
    });
  }

  async getErrorResponse(): Promise<{statusCode: number; json: () => unknown}> {
    return this.server.inject({method: "GET", url: "/error"});
  }
}

describe("RestApiServer", () => {
  let server: TestRestApiServer | undefined;

  afterEach(async () => {
    await server?.close();
  });

  it.each([GossipAction.IGNORE, GossipAction.REJECT])(
    "returns 400 for a %s gossip validation error",
    async (action) => {
      server = new TestRestApiServer({port: 0}, {logger: getMockedLogger(), metrics: null});
      server.registerErrorRoute(new GossipActionError(action, {code: "TEST_GOSSIP_VALIDATION_ERROR"}));

      const response = await server.getErrorResponse();

      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({
        code: 400,
        message: "TEST_GOSSIP_VALIDATION_ERROR",
      });
    }
  );

  it("returns 500 for an unexpected error", async () => {
    server = new TestRestApiServer({port: 0}, {logger: getMockedLogger(), metrics: null});
    server.registerErrorRoute(new Error("Unexpected error"));

    const response = await server.getErrorResponse();

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      code: 500,
      message: "Unexpected error",
    });
  });
});
