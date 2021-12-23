import {interopSecretKey} from "@chainsafe/lodestar-beacon-state-transition";
import fastify from "fastify";
import fs from "fs";
import {IncomingMessage} from "http";
import {fromHexString} from "@chainsafe/ssz";
import {SecretKey, init} from "@chainsafe/bls";
import {rootDir, PORT} from "./constants";

export const filename = `${rootDir}/keyPairs.txt`;

interface ISignBody {
  signingRoot: string; // Data to sign as a hex string
}
interface ISignParams {
  identifier: string; // BLS public key as a hex string.
}

export async function createServer(numOfKeys: number): Promise<void> {
  generateFile(numOfKeys);
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
    // const pkHex = identifier.startsWith("0x") ? identifier.slice(2) : identifier;
    try {
      const keyPairs = fs.readFileSync(filename, {encoding: "utf8", flag: "r"}).split("\n");
      const publicKeys = keyPairs.map((item) => item.split(",")[0]);
      const secretKeys = keyPairs.map((item) => item.split(",")[1]);
      const index = publicKeys.indexOf(identifier);
      if (index === -1) {
        const index = publicKeys.indexOf(identifier.slice(2));
        if (index === -1) {
          return await res.code(404).send({error: `Key not found: ${identifier}`});
        }
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
    removeFile();
  });
  await server.listen(PORT);
}

export const generateFile = (numOfKeys: number): void => {
  fs.open(filename, "r", function (err) {
    if (!err) {
      removeFile();
    }
    writeKeysToFile(numOfKeys);
  });
};

const writeKeysToFile = (numOfKeys: number): void => {
  const secretKeys = Array.from({length: numOfKeys}, (_, i) => interopSecretKey(i));
  const secretKeysHex = secretKeys.map((sk) => sk.toHex());
  const publicKeysHex = secretKeys.map((sk) => sk.toPublicKey().toHex());
  let keyPairFileData = "";
  for (let i = 0; i < secretKeysHex.length; i++) {
    keyPairFileData += `${publicKeysHex[i]},${secretKeysHex[i]}`;
    if (i !== secretKeysHex.length - 1) {
      keyPairFileData += "\n";
    }
  }
  fs.writeFile(filename, keyPairFileData, function (err) {
    if (err) {
      console.log(err);
    }
  });
};

export const removeFile = (): void => {
  fs.unlink(filename, (err) => {
    if (err) console.log(err);
  });
};
