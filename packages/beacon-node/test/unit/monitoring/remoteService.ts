import {fastify} from "fastify";
import {afterAll, expect} from "vitest";
import {RemoteServiceError} from "../../../src/monitoring/service.js";
import {ProcessType} from "../../../src/monitoring/types.js";
import {BEACON_NODE_STATS_SCHEMA, ClientStatsSchema, SYSTEM_STATS_SCHEMA, VALIDATOR_STATS_SCHEMA} from "./schemas.js";

/* eslint-disable no-console */

type ReceivedData = Record<string, unknown> & {process: ProcessType};

export const remoteServiceRoutes = {
  success: "/success",
  error: "/error",
  pending: "/pending",
};

export const remoteServiceError: RemoteServiceError = {status: "error", data: null};

/**
 * Starts mocked remote service to receive and validate client stats
 */
export async function startRemoteService(): Promise<{baseUrl: URL}> {
  const server = fastify();

  server.post(remoteServiceRoutes.success, {}, async (request, reply) => {
    if (Array.isArray(request.body)) {
      request.body.forEach(validateRequestData);
    } else {
      validateRequestData(request.body as ReceivedData);
    }

    return reply.status(200).send();
  });

  server.post(remoteServiceRoutes.error, {}, async (_request, reply) => reply.status(400).send(remoteServiceError));

  server.post(remoteServiceRoutes.pending, {}, () => {
    // keep request pending until timeout is reached or aborted
  });

  server.addHook("onError", (_request, _reply, error, done) => {
    console.log(`Error: ${error.message}`);
    done();
  });

  // ask the operating system to assign a free (ephemeral) port
  // and use IPv4 localhost "127.0.0.1" to avoid known IPv6 issues
  const baseUrl = await server.listen({host: "127.0.0.1", port: 0});

  afterAll(() => {
    // there is no need to wait for server to be closed
    server.close().catch(console.log);
  });

  return {baseUrl: new URL(baseUrl)};
}

function validateRequestData(data: ReceivedData): void {
  switch (data.process) {
    case ProcessType.BeaconNode:
      validateClientStats(data, BEACON_NODE_STATS_SCHEMA);
      break;
    case ProcessType.Validator:
      validateClientStats(data, VALIDATOR_STATS_SCHEMA);
      break;
    case ProcessType.System:
      validateClientStats(data, SYSTEM_STATS_SCHEMA);
      break;
    default:
      throw new Error(`Invalid process type "${data.process}"`);
  }
}

function validateClientStats(data: ReceivedData, schema: ClientStatsSchema): void {
  for (const s of schema) {
    try {
      expect(data[s.key]).toBeInstanceOf(s.type);
    } catch (_e) {
      throw new Error(
        `Validation of property "${s.key}" failed. Expected type "${s.type}" but received "${typeof data[s.key]}".`
      );
    }
  }
}
