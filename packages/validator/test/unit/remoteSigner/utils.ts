import fastify from "fastify";
import fs from "fs";
import {IncomingMessage, Server} from "http";
import {fromHexString} from "@chainsafe/ssz";
import {SecretKey, init} from "@chainsafe/bls";

export const filename = "./test/unit/keyPairs.txt";

interface ISignBody {
  signingRoot: string; // Data to sign as a hex string
}
interface ISignParams {
  identifier: string; // BLS public key as a hex string.
}

// export class RemoteServer {
//   private server: fastify
//   constructor() {
//     this.server = fastify()
//   }

//   this.server.get("/upcheck", async (req, res) => {
//     return await res.code(200).send({status: "OK"});
//   });

//   server.get("/keys", async (req, res) => {
//     try {
//       const keyPairs = fs.readFileSync(filename, {encoding: "utf8", flag: "r"}).split("\n");
//       const publicKeys = keyPairs.map((item) => item.split(",")[0]);
//       return await res.code(200).send({keys: publicKeys});
//     } catch (err) {
//       const result = (err as Error).message;
//       if (result === `EACCES: permission denied, open '${filename}'`) {
//         return await res.code(500).send({error: "Storage error: PermissionDenied"});
//       }
//       return await res.code(500).send({error: `${err}`});
//     }
//   });

//   // eslint-disable-next-line @typescript-eslint/naming-convention
//   server.post<{Params: ISignParams; Body: ISignBody}>("/sign/:identifier", async (req, res) => {
//     await init("blst-native");
//     const identifier: string = req.params.identifier;
//     const signingRoot: string = req.body.signingRoot;
//     const pkHex = identifier.startsWith("0x") ? identifier.slice(2) : identifier;
//     try {
//       const keyPairs = fs.readFileSync(filename, {encoding: "utf8", flag: "r"}).split("\n");
//       const publicKeys = keyPairs.map((item) => item.split(",")[0]);
//       const secretKeys = keyPairs.map((item) => item.split(",")[1]);
//       const index = publicKeys.indexOf(pkHex);
//       if (index === -1) {
//         return await res.code(404).send({error: `Key not found: ${identifier}`});
//       }
//       const skHex = secretKeys[index];
//       const secretKey = SecretKey.fromHex(skHex);
//       const signingRootBytes = Uint8Array.from(fromHexString(signingRoot));
//       const sig = secretKey.sign(signingRootBytes);
//       return await res.code(200).send({signature: sig.toHex()});
//     } catch (err) {
//       const result = (err as Error).message;
//       if (result === `EACCES: permission denied, open '${filename}'`) {
//         return await res.code(500).send({error: "Storage error: PermissionDenied"});
//       }
//       return await res.code(500).send({error: `${err}`});
//     }
//   });
// }
export async function createServer(): Promise<void> {
  const afterEachCallbacks: (() => Promise<any> | any)[] = [];
  afterEach(async () => {
    while (afterEachCallbacks.length > 0) {
      const callback = afterEachCallbacks.pop();
      if (callback) await callback();
    }
  });

  const server = fastify();

  server.get("/upcheck", async (req, res) => {
    return await res.code(200).send({status: "OK"});
  });

  server.get("/keys", async (req, res) => {
    try {
      const keyPairs = fs.readFileSync(filename, {encoding: "utf8", flag: "r"}).split("\n");
      const publicKeys = keyPairs.map((item) => item.split(",")[0]);
      return await res.code(200).send({keys: publicKeys});
    } catch (err) {
      const result = (err as Error).message;
      if (result === `EACCES: permission denied, open '${filename}'`) {
        return await res.code(500).send({error: "Storage error: PermissionDenied"});
      }
      return await res.code(500).send({error: `${err}`});
    }
  });

  // eslint-disable-next-line @typescript-eslint/naming-convention
  server.post<{Params: ISignParams; Body: ISignBody}>("/sign/:identifier", async (req, res) => {
    await init("blst-native");
    const identifier: string = req.params.identifier;
    const signingRoot: string = req.body.signingRoot;
    const pkHex = identifier.startsWith("0x") ? identifier.slice(2) : identifier;
    try {
      const keyPairs = fs.readFileSync(filename, {encoding: "utf8", flag: "r"}).split("\n");
      const publicKeys = keyPairs.map((item) => item.split(",")[0]);
      const secretKeys = keyPairs.map((item) => item.split(",")[1]);
      const index = publicKeys.indexOf(pkHex);
      if (index === -1) {
        return await res.code(404).send({error: `Key not found: ${identifier}`});
      }
      const skHex = secretKeys[index];
      const secretKey = SecretKey.fromHex(skHex);
      const signingRootBytes = Uint8Array.from(fromHexString(signingRoot));
      const sig = secretKey.sign(signingRootBytes);
      return await res.code(200).send({signature: sig.toHex()});
    } catch (err) {
      const result = (err as Error).message;
      if (result === `EACCES: permission denied, open '${filename}'`) {
        return await res.code(500).send({error: "Storage error: PermissionDenied"});
      }
      return await res.code(500).send({error: `${err}`});
    }
  });

  const reqs = new Set<IncomingMessage>();
  server.addHook("onRequest", async (req) => reqs.add(req.raw));
  afterEachCallbacks.push(async () => {
    for (const req of reqs) req.destroy();
    await server.close();
  });
  await server.listen(9002);
}
