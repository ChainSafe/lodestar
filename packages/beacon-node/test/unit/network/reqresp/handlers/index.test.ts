import {describe, expect, it} from "vitest";
import {config} from "@lodestar/config/default";
import {RespStatus, ResponseError} from "@lodestar/reqresp";
import {IBeaconChain} from "../../../../../src/chain/index.js";
import {IBeaconDb} from "../../../../../src/db/index.js";
import {getReqRespHandlers} from "../../../../../src/network/reqresp/handlers/index.js";
import {ReqRespMethod} from "../../../../../src/network/reqresp/types.js";

describe("network / reqresp / handlers", () => {
  it("rejects malformed DataColumnSidecarsByRoot request bytes as invalid request", () => {
    const handler = getReqRespHandlers({
      chain: {config} as unknown as IBeaconChain,
      db: {} as IBeaconDb,
    })(ReqRespMethod.DataColumnSidecarsByRoot);

    try {
      handler({data: Buffer.alloc(20), version: 1}, undefined as never, "test");
      expect.fail("expected malformed request bytes to be rejected");
    } catch (e) {
      expect(e).toBeInstanceOf(ResponseError);
      expect((e as ResponseError).status).toBe(RespStatus.INVALID_REQUEST);
    }
  });
});
