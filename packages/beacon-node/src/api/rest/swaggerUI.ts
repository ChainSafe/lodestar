import {FastifyInstance} from "fastify";
import {BeaconRestApiServerOpts} from "./index.js";

export async function registerSwaggerUIRoutes(
  server: FastifyInstance,
  opts: BeaconRestApiServerOpts,
  version = ""
): Promise<void> {
  await server.register(await import("@fastify/swagger"), {
    openapi: {
      info: {
        title: "Lodestar API",
        description: "API specification for the Lodestar beacon node",
        version,
        contact: {
          name: "Lodestar Github",
          url: "https://github.com/chainsafe/lodestar",
        },
      },
      externalDocs: {
        url: "https://chainsafe.github.io/lodestar",
        description: "Lodestar documentation",
      },
      tags: opts.api.map((namespace) => ({name: namespace})),
    },
  });
  await server.register(await import("@fastify/swagger-ui"), {
    theme: {
      title: "Lodestar API",
      favicon: await getFavicon(),
    },
    logo: await getLogo(),
  });
}

/**
 * Fallback-friendly function to get an asset
 */
async function getAsset(name: string): Promise<Buffer | undefined> {
  try {
    const path = await import("node:path");
    const fs = await import("node:fs/promises");
    const url = await import("node:url");
    const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
    return await fs.readFile(path.join(__dirname, "../../../../../assets/", name));
  } catch (_e) {
    return undefined;
  }
}

export async function getFavicon() {
  const content = await getAsset("round-icon.ico");
  if (!content) {
    return undefined;
  }

  return [
    {
      filename: "round-icon.ico",
      rel: "icon",
      sizes: "16x16",
      type: "image/x-icon",
      content,
    },
  ];
}

export async function getLogo() {
  const content = await getAsset("lodestar_icon_text_white.png");
  if (!content) {
    return undefined;
  }

  return {
    type: "image/png",
    content,
  };
}
