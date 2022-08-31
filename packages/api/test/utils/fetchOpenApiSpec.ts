import fs from "node:fs";
import fetch from "cross-fetch";
import yaml from "js-yaml";
import {OpenApiFile, OpenApiJson} from "./parseOpenApiSpec.js";

/* eslint-disable no-console */

export async function fetchOpenApiSpec(openApiFile: OpenApiFile): Promise<OpenApiJson> {
  if (fs.existsSync(openApiFile.filepath)) {
    const openApiJson = yaml.load(fs.readFileSync(openApiFile.filepath, "utf8")) as OpenApiJson;
    if (openApiFile.version.test(openApiJson.info.version)) {
      // Ok, cached file has wanted version
      return openApiJson;
    }
  }

  // File not cached, or wrong version
  console.log(`Downloading oapi file from ${openApiFile.url}`);
  const openApiStr = await fetch(openApiFile.url).then((res) => res.text());

  let openApiJson: OpenApiJson;
  try {
    openApiJson = yaml.load(openApiStr) as OpenApiJson;
  } catch (e) {
    console.log(openApiStr);
    throw e;
  }
  // Parse before writting to ensure it's proper JSON
  fs.writeFileSync(openApiFile.filepath, openApiStr);

  if (!openApiFile.version.test(openApiJson.info.version)) {
    throw Error(`Downloaded oapi file version ${openApiJson.info.version} doesn't match ${openApiFile.version}`);
  }

  return openApiJson;
}
