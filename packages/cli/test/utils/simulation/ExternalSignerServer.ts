import fastify from "fastify";
import {fromHexString, toHexString} from "@chainsafe/ssz";
import type {SecretKey} from "@chainsafe/bls/types";
import {EXTERNAL_SIGNER_BASE_PORT} from "./utils.js";

export class ExternalSignerServer {
  static totalProcessCount = 0;

  readonly address: string = "127.0.0.1";
  readonly port: number;

  private server: ReturnType<typeof fastify>;

  constructor(secretKeys: SecretKey[]) {
    const secretKeyMap = new Map<string, SecretKey>();
    for (const secretKey of secretKeys) {
      const pubkeyHex = toHexString(secretKey.toPublicKey().toBytes());
      secretKeyMap.set(pubkeyHex, secretKey);
    }
    ExternalSignerServer.totalProcessCount++;
    this.port = EXTERNAL_SIGNER_BASE_PORT + ExternalSignerServer.totalProcessCount;

    this.server = fastify();

    this.server.get("/upcheck", async () => {
      return {status: "OK"};
    });

    this.server.get("/keys", async () => {
      return {keys: Array.from(secretKeyMap.keys())};
    });

    /* eslint-disable @typescript-eslint/naming-convention */
    this.server.post<{
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
  }

  get url(): string {
    return `http://${this.address}:${this.port}`;
  }

  async start(): Promise<void> {
    console.log(`Starting external signer server at ${this.url}.`);
    await this.server.listen(this.port, this.address);
    console.log(`Started external signer server at ${this.url}.`);
  }

  async stop(): Promise<void> {
    console.log(`Stopping external signer server at ${this.url}.`);
    await this.server.close();
    console.log(`Stopped external signer server at ${this.url}.`);
  }
}
