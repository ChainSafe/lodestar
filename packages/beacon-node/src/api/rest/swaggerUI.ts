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
        description: "",
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
    },
  });
}
