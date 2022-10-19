import fastify from "fastify";
import {fromHexString} from "@chainsafe/ssz";
import type {SecretKey} from "@chainsafe/bls/types";
import {EXTERNAL_SIGNER_BASE_PORT} from "./utils.js";

/* eslint-disable no-console */

export class ExternalSignerServer {
  static totalProcessCount = 0;

  readonly address: string = "127.0.0.1";
  readonly port: number;

  private server: ReturnType<typeof fastify>;
  private secretKeyMap = new Map<string, SecretKey>();

  constructor(secretKeys: SecretKey[]) {
    this.addKeys(secretKeys);
    ExternalSignerServer.totalProcessCount++;
    this.port = EXTERNAL_SIGNER_BASE_PORT + ExternalSignerServer.totalProcessCount;

    this.server = fastify();

    this.server.get("/upcheck", async () => {
      return {status: "OK"};
    });

    this.server.get("/api/v1/eth2/publicKeys", async () => {
      return [...this.secretKeyMap.keys()];
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
    }>("/api/v1/eth2/sign/:identifier", async (req) => {
      const pubkeyHex: string = req.params.identifier;
      const signingRootHex: string = req.body.signingRoot;

      const secretKey = this.secretKeyMap.get(pubkeyHex);
      if (!secretKey) {
        console.log([...this.secretKeyMap.keys()].join("\n"));
        throw Error(`pubkey not known ${pubkeyHex}`);
      }

      return {signature: secretKey.sign(fromHexString(signingRootHex)).toHex()};
    });
  }

  addKeys(secretKeys: SecretKey[]): void {
    for (const secretKey of secretKeys) {
      const pubkeyHex = secretKey.toPublicKey().toHex();
      this.secretKeyMap.set(pubkeyHex, secretKey);
    }
  }

  get url(): string {
    return `http://${this.address}:${this.port}`;
  }

  async start(): Promise<void> {
    console.log(`Starting external signer server at ${this.url}.`);
    await this.server.listen(this.port, this.address);
  }

  async stop(): Promise<void> {
    console.log(`Stopping external signer server at ${this.url}.`);
    await this.server.close();
  }
}
