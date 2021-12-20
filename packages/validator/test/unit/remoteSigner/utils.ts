import fastify from "fastify";
import {IncomingMessage} from "http";
import {fromHexString} from "@chainsafe/ssz";
import {SecretKey, init} from "@chainsafe/bls";

export async function getServer(): Promise<{baseUrl: string}> {
  const afterEachCallbacks: (() => Promise<any> | any)[] = [];
  afterEach(async () => {
    while (afterEachCallbacks.length > 0) {
      const callback = afterEachCallbacks.pop();
      if (callback) await callback();
    }
  });
  const server = fastify();

  const publicToPrivate = new Map<string, string>();

  const secretKeys = [
    "0x68081afeb7ad3e8d469f87010804c3e8d53ef77d393059a55132637206cc59ec",
    "0x25295f0d1d592a90b333e26e85149708208e9f8e8bc18f6c77bd62f8ad7a6866",
    "0x51d0b65185db6989ab0b560d6deed19c7ead0e24b9b6372cbecb1f26bdfad000",
    "0x315ed405fafe339603932eebe8dbfd650ce5dafa561f6928664c75db85f97857",
    "0x25b1166a43c109cb330af8945d364722757c65ed2bfed5444b5a2f057f82d391",
    "0x3f5615898238c4c4f906b507ee917e9ea1bb69b93f1dbd11a34d229c3b06784b",
    "0x055794614bc85ed5436c1f5cab586aab6ca84835788621091f4f3b813761e7a8",
    "0x1023c68852075965e0f7352dee3f76a84a83e7582c181c10179936c6d6348893",
    "0x3a941600dc41e5d20e818473b817a28507c23cdfdb4b659c15461ee5c71e41f5",
  ];

  for (let i = 0; i < secretKeys.length; i++) {
    const secretKey = SecretKey.fromHex(secretKeys[i]);
    const publicKey = secretKey.toPublicKey().toHex();
    publicToPrivate.set(publicKey, secretKeys[i]);
  }

  server.get("/upcheck", async (req, res) => {
    // const response = {"status": "OK"};
    return await res.code(200).send({status: "OK"});
  });
  server.get("/keys", async (req, res) => {
    // const keys = await APIs.getKeys();
    const keys = Array.from(publicToPrivate.keys());
    return await res.code(200).send({keys: keys});
  });
  interface ISignBody {
    signingRoot: string;
  }
  interface ISignParams {
    identifier: string; // BLS public key as a hex string.
  }

  // eslint-disable-next-line @typescript-eslint/naming-convention
  server.post<{Params: ISignParams; Body: ISignBody}>("/sign/:identifier", async (req, res) => {
    await init("blst-native");
    const identifier: string = req.params.identifier;
    const signingRoot: string = req.body.signingRoot;
    const pkHex = identifier.startsWith("0x") ? identifier.slice(2) : identifier;
    const skHex = publicToPrivate.get(pkHex);
    if (!skHex) {
      return await res.code(404).send({error: `Key not found: ${identifier}`});
    }
    const secretKey = SecretKey.fromHex(skHex);
    const signingRootBytes = Uint8Array.from(fromHexString(signingRoot));
    const sig = secretKey.sign(signingRootBytes);
    console.log(sig.toBytes());
    return await res.code(200).send({signature: sig.toHex()});
  });

  const reqs = new Set<IncomingMessage>();
  server.addHook("onRequest", async (req) => reqs.add(req.raw));
  afterEachCallbacks.push(async () => {
    for (const req of reqs) req.destroy();
    await server.close();
  });
  // console.log("baseurl", await server.listen(9001));

  return {baseUrl: await server.listen(9002)};
}
