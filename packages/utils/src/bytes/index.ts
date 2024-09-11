import {
  toHex as browserToHex,
  toRootHex as browserToRootHex,
  fromHex as browserFromHex,
  toPubkeyHex as browserToPubkeyHex,
} from "./browser.js";
import {
  toHex as nodeToHex,
  toRootHex as nodeToRootHex,
  fromHex as nodeFromHex,
  toPubkeyHex as nodeToPubkeyHex,
} from "./nodejs.js";

let toHex = browserToHex;
let toRootHex = browserToRootHex;
let toPubkeyHex = browserToPubkeyHex;
let fromHex = browserFromHex;

if (typeof Buffer !== "undefined") {
  toHex = nodeToHex;
  toRootHex = nodeToRootHex;
  toPubkeyHex = nodeToPubkeyHex;
  fromHex = nodeFromHex;
}

export {toHex, toRootHex, toPubkeyHex, fromHex};
