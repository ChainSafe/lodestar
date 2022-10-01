import fastify from "fastify";
import {fromHexString} from "@chainsafe/ssz";
import type {SecretKey} from "@chainsafe/bls/types";

type OnError = (error: Error) => void;

// TODO: Once this is deprecated, remove LocalKeystores.secretKeys
export function prepareInMemoryWeb3signer(
  onError: OnError,
  opts: ExternalSignerServerOpts
): {
  killGracefully(): Promise<void>;
} {
  const externalSignerServer = new ExternalSignerServer(onError, opts);

  return {
    killGracefully() {
      return externalSignerServer.stop();
    },
  };
}

interface ExternalSignerServerOpts {
  port: number;
  secretKeys: SecretKey[];
}

class ExternalSignerServer {
  static totalProcessCount = 0;

  readonly address: string = "127.0.0.1";

  private server: ReturnType<typeof fastify>;

  constructor(onError: OnError, private readonly opts: ExternalSignerServerOpts) {
    const secretKeyMap = new Map<string, SecretKey>();
    for (const secretKey of opts.secretKeys) {
      const pubkeyHex = secretKey.toPublicKey().toHex();
      secretKeyMap.set(pubkeyHex, secretKey);
    }

    this.server = fastify();

    this.server.get("/upcheck", async () => {
      return {status: "OK"};
    });

    this.server.get("/api/v1/eth2/publicKeys", async () => {
      return [...secretKeyMap.keys()];
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

      const secretKey = secretKeyMap.get(pubkeyHex);
      if (!secretKey) {
        throw Error(`pubkey not known ${pubkeyHex}`);
      }

      return {signature: secretKey.sign(fromHexString(signingRootHex)).toHex()};
    });

    this.server.listen(this.opts.port, this.address).catch((e) => {
      onError(e);
    });
  }

  async stop(): Promise<void> {
    await this.server.close();
  }
}
