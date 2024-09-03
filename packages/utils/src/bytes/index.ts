import {toHex as browserToHex, toRootHex as browserToRootHex, fromHex as browserFromHex} from "./browser.js";
import {toHex as nodeToHex, toRootHex as nodeToRootHex, fromHex as nodeFromHex} from "./nodejs.js";

let toHex = browserToHex;
let toRootHex = browserToRootHex;
let fromHex = browserFromHex;

if (typeof Buffer !== "undefined") {
  toHex = nodeToHex;
  toRootHex = nodeToRootHex;
  fromHex = nodeFromHex;
}

export {toHex, toRootHex, fromHex};
