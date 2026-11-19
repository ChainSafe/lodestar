import fs from "node:fs";
import path from "node:path";
import {fetch, retry} from "@lodestar/utils";
import {OpenApiFile, OpenApiJson} from "./parseOpenApiSpec.js";

export async function fetchOpenApiSpec(openApiFile: OpenApiFile): Promise<OpenApiJson> {
  if (fs.existsSync(openApiFile.filepath)) {
    const openApiJson = JSON.parse(fs.readFileSync(openApiFile.filepath, "utf8")) as OpenApiJson;
    if (openApiFile.version.test(openApiJson.info.version)) {
      // Ok, cached file has wanted version
      return openApiJson;
    }
  }

  // File not cached, or wrong version
  console.log(`Downloading oapi file from ${openApiFile.url}`);
  const openApiStr = await retry(
    async () => {
      const res = await fetch(openApiFile.url);
      if (!res.ok) {
        throw new Error(`Failed to download file from ${openApiFile.url}: ${res.status} ${res.statusText}`);
      }
      return res.text();
    },
    {
      retries: 3,
      retryDelay: 1000,
      onRetry: (e, attempt) => {
        console.log(`Retrying oapi file download attempt=${attempt}: ${e.message}`);
      },
    }
  );

  // Parse before writting to ensure it's proper JSON
  let openApiJson: OpenApiJson;
  try {
    openApiJson = JSON.parse(openApiStr) as OpenApiJson;
  } catch (e) {
    console.log(openApiStr);
    throw e;
  }

  fs.mkdirSync(path.dirname(openApiFile.filepath), {recursive: true});
  fs.writeFileSync(openApiFile.filepath, openApiStr);

  if (!openApiFile.version.test(openApiJson.info.version)) {
    throw Error(`Downloaded oapi file version ${openApiJson.info.version} doesn't match ${openApiFile.version}`);
  }

  return openApiJson;
}
