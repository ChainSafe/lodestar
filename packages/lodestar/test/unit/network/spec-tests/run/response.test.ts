import fs from "fs";
import path from "path";
import {AbortController} from "abort-controller";
import all from "it-all";
import pipe from "it-pipe";
import {config} from "@chainsafe/lodestar-config/mainnet";
import {WinstonLogger} from "@chainsafe/lodestar-utils";
import {Methods} from "../../../../../src/constants";
import {eth2ResponseDecode} from "../../../../../src/network/encoders/response";
import {parseNetworkResponseTestData} from "../format/response";
import {testDirResponse} from "../paths";

describe("Network test data - response", () => {
  const logger = new WinstonLogger();

  const files = fs.readdirSync(testDirResponse);
  if (files.length === 0) {
    throw Error(`No network test data found in ${testDirResponse}`);
  }

  for (const testId of files) {
    it(testId, async () => {
      const testDir = path.join(testDirResponse, testId);
      const data = parseNetworkResponseTestData(testDir);

      const requestId = "sample-request-id";
      const controller = new AbortController();

      const resArr = await all(
        pipe(data.chunks, eth2ResponseDecode(config, logger, data.method, data.encoding, requestId, controller))
      );

      const type = Methods[data.method].responseSSZType(config);
      resArr.forEach((res, i) => {
        if (!type.equals(res as any, data.responseBody[i] as any)) {
          throw Error(`chunk ${i} is not equal`);
        }
      });
    });
  }

  // it("Status ERROR", async () => {
  //   const error = new RpcError(RpcResponseStatus.SERVER_ERROR, "Something went wrong");
  //   await sendResponse({config, logger}, requestId, method, encoding, sink as any, error);
  // });
});
