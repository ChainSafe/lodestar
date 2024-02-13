import crypto from "node:crypto";
import {itBench} from "@dapplion/benchmark";
import {PubkeyIndexMap as PubkeyIndexMapRust} from "@chainsafe/pubkey-index-map";
import {PubkeyIndexMap as PubkeyIndexMapJs} from "../../utils/oldPubkeyCache.js";

describe("PubkeyIndexMap", function () {
  const mapJs = new PubkeyIndexMapJs();
  const mapRust = new PubkeyIndexMapRust();
  const pubkeys: Uint8Array[] = [];
  const count = 200_000;

  const rand = (): number => Math.floor(Math.random() * count);

  before(function () {
    this.timeout(60 * 1000);
    for (let i = 0; i < count; i++) {
      const pubkey = crypto.randomBytes(48);
      pubkeys.push(pubkey);
      mapJs.set(pubkey, i);
      mapRust.set(pubkey, i);
    }
  });

  itBench({
    id: "PubkeyIndexMap(js) get",
    fn: () => {
      for (let i = 0; i < count; i++) {
        mapJs.get(pubkeys[i]);
      }
      mapJs.get(pubkeys[rand()]);
    },
  });

  itBench({
    id: "PubkeyIndexMap(rust) get",
    fn: () => {
      for (let i = 0; i < count; i++) {
        mapJs.get(pubkeys[i]);
      }
      mapRust.get(pubkeys[rand()]);
    },
  });
});
