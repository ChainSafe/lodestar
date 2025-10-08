import {
  fromHex as browserFromHex,
  fromHexInto as browserFromHexInto,
  toHex as browserToHex,
  toPubkeyHex as browserToPubkeyHex,
  toRootHex as browserToRootHex,
} from "./browser.js";
import {
  fromHex as nodeFromHex,
  toHex as nodeToHex,
  toPubkeyHex as nodeToPubkeyHex,
  toRootHex as nodeToRootHex,
} from "./nodejs.js";

let toHex = browserToHex;
let toRootHex = browserToRootHex;
let toPubkeyHex = browserToPubkeyHex;
let fromHex = browserFromHex;
// there is no fromHexInto for NodeJs as the performance of browserFromHexInto is >100x faster
const fromHexInto = browserFromHexInto;

if (typeof Buffer !== "undefined") {
  toHex = nodeToHex;
  toRootHex = nodeToRootHex;
  toPubkeyHex = nodeToPubkeyHex;
  fromHex = nodeFromHex;
}

export {toHex, toRootHex, toPubkeyHex, fromHex, fromHexInto};
