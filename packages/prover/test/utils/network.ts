import {request} from "node:http";
import {sleep} from "@lodestar/utils";

export async function waitForEndpoint(url: string): Promise<void> {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const status = await new Promise((resolve) => {
      const req = request(url, {method: "GET"}, (res) => {
        resolve(res.statusCode);
      });
      req.end();
    });
    if (status === 200) {
      break;
    } else {
      await sleep(1000);
    }
  }
}
