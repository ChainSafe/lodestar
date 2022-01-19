import fetch from "cross-fetch";

/**
 * Return public keys from the server.
 */
export async function remoteSignerGetKeys(remoteSignerUrl: string): Promise<string[]> {
  const res = await fetch(`${remoteSignerUrl}/keys`, {
    method: "GET",
    headers: {"Content-Type": "application/json"},
  });

  const data = await handlerRemoteSignerResponse<{keys: string[]}>(res);
  return data.keys;
}

/**
 * Return signature in bytes. Assumption that the pubkey has it's corresponding secret key in the keystore of the remote signer.
 */
export async function remoteSignerPostSignature(
  remoteSignerUrl: string,
  pubkeyHex: string,
  signingRootHex: string
): Promise<string> {
  const res = await fetch(`${remoteSignerUrl}/sign/${pubkeyHex}`, {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({
      signingRoot: signingRootHex,
    }),
  });

  const data = await handlerRemoteSignerResponse<{signature: string}>(res);
  return data.signature;
}

/**
 * Return upcheck status from server.
 */
export async function remoteSignerUpCheck(remoteUrl: string): Promise<boolean> {
  const res = await fetch(`${remoteUrl}/upcheck`, {
    method: "GET",
    headers: {"Content-Type": "application/json"},
  });

  const data = await handlerRemoteSignerResponse<{status: string}>(res);
  return data.status === "OK";
}

async function handlerRemoteSignerResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const errBody = await res.text();
    throw Error(`${errBody}`);
  }

  return JSON.parse(await res.text()) as T;
}
