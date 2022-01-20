import fastify from "fastify";
import {fromHexString, toHexString} from "@chainsafe/ssz";
import {SecretKey} from "@chainsafe/bls";
import {PubkeyHex} from "../../src/types";

/**
 * Creates a fastify server with registered remote signer routes.
 * Must call .listen() on the server to start
 */
export function createExternalSignerServer(secretKeys: SecretKey[]): ReturnType<typeof fastify> {
  const secretKeyMap = new Map<PubkeyHex, SecretKey>();
  for (const secretKey of secretKeys) {
    const pubkeyHex = toHexString(secretKey.toPublicKey().toBytes());
    secretKeyMap.set(pubkeyHex, secretKey);
  }

  const server = fastify();

  server.get("/upcheck", async () => {
    return {status: "OK"};
  });

  server.get("/keys", async () => {
    return {keys: Array.from(secretKeyMap.keys())};
  });

  /* eslint-disable @typescript-eslint/naming-convention */
  server.post<{
    Params: {
      /** BLS public key as a hex string. */
      identifier: string;
    };
    Body: {
      /** Data to sign as a hex string */
      signingRoot: string;
    };
  }>("/sign/:identifier", async (req) => {
    const pubkeyHex: string = req.params.identifier;
    const signingRootHex: string = req.body.signingRoot;

    const secretKey = secretKeyMap.get(pubkeyHex);
    if (!secretKey) {
      throw Error(`pubkey not known ${pubkeyHex}`);
    }

    return {signature: secretKey.sign(fromHexString(signingRootHex)).toHex()};
  });

  return server;
}
