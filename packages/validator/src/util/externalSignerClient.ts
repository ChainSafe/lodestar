import fetch from "cross-fetch";

/**
 * Return public keys from the server.
 */
export async function externalSignerGetKeys(externalSignerUrl: string): Promise<string[]> {
  const res = await fetch(`${externalSignerUrl}/keys`, {
    method: "GET",
    headers: {"Content-Type": "application/json"},
  });

  const data = await handlerExternalSignerResponse<{keys: string[]}>(res);
  return data.keys;
}

/**
 * Return signature in bytes. Assumption that the pubkey has it's corresponding secret key in the keystore of an external signer.
 */
export async function externalSignerPostSignature(
  externalSignerUrl: string,
  pubkeyHex: string,
  signingRootHex: string
): Promise<string> {
  const res = await fetch(`${externalSignerUrl}/sign/${pubkeyHex}`, {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({
      signingRoot: signingRootHex,
    }),
  });

  const data = await handlerExternalSignerResponse<{signature: string}>(res);
  return data.signature;
}

/**
 * Return upcheck status from server.
 */
export async function externalSignerUpCheck(remoteUrl: string): Promise<boolean> {
  const res = await fetch(`${remoteUrl}/upcheck`, {
    method: "GET",
    headers: {"Content-Type": "application/json"},
  });

  const data = await handlerExternalSignerResponse<{status: string}>(res);
  return data.status === "OK";
}

async function handlerExternalSignerResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const errBody = await res.text();
    throw Error(`${errBody}`);
  }

  return JSON.parse(await res.text()) as T;
}
