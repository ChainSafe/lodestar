let toHex: (bytes: Uint8Array) => string;
let toRootHex: (root: Uint8Array) => string;
let fromHex: (hex: string) => Uint8Array;

if (typeof Buffer !== "undefined") {
  toHex = (await import("./nodejs.js")).toHex;
  toRootHex = (await import("./nodejs.js")).toRootHex;
  fromHex = (await import("./nodejs.js")).fromHex;
} else {
  toHex = (await import("./browser.js")).toHex;
  toRootHex = (await import("./browser.js")).toRootHex;
  fromHex = (await import("./browser.js")).fromHex;
}

export {toHex, toRootHex, fromHex};
