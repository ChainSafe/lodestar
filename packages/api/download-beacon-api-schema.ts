/* eslint-disable no-console */
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

import {version} from "./src/schema/version.js";

// eslint-disable-next-line @typescript-eslint/naming-convention
const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

async function downloadBeaconApiSchema(): Promise<void> {
  const url = `https://github.com/ethereum/beacon-APIs/releases/download/${version}/beacon-node-oapi.json`;
  const filepath = path.join(__dirname, "./src/schema/beacon-node-oapi.json");
  console.log(`Downloading oapi file from ${url}`);
  let openApiStr = await fetch(url).then((res) => res.text());

  // Parse before writting to ensure it's proper JSON
  try {
    openApiStr = JSON.stringify(JSON.parse(openApiStr));
  } catch (e) {
    console.log(openApiStr);
    throw e;
  }

  fs.writeFileSync(filepath, openApiStr);
}

await downloadBeaconApiSchema();
