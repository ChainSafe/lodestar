import {Method, Version, Encoding, protocolPrefix, Protocol} from "../types";

const methods = new Set(Object.values(Method));
const versions = new Set(Object.values(Version));
const encodings = new Set(Object.values(Encoding));

/** Render protocol ID */
export function formatProtocolId(method: Method, version: Version, encoding: Encoding): string {
  return `${protocolPrefix}/${method}/${version}/${encoding}`;
}

export function parseProtocolId(protocolId: string): Protocol {
  if (!protocolId.startsWith(protocolPrefix)) {
    throw Error(`Unknown protocolId prefix: ${protocolId}`);
  }

  // +1 for the first "/"
  const suffix = protocolId.slice(protocolPrefix.length + 1);

  const [method, version, encoding] = suffix.split("/") as [Method, Version, Encoding];

  if (!method || !methods.has(method)) throw Error(`Unknown protocolId method ${method}`);
  if (!version || !versions.has(version)) throw Error(`Unknown protocolId version ${version}`);
  if (!encoding || !encodings.has(encoding)) throw Error(`Unknown protocolId encoding ${encoding}`);

  return {method, version, encoding};
}
