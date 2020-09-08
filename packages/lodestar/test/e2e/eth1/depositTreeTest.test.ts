import "mocha";
import {expect} from "chai";
import {Eth1Provider, IEth1Block, IDepositEvent} from "../../../src/eth1";
import {IEth1Options} from "../../../src/eth1/options";
import {getMedallaConfig, medalla} from "./util";
import {Deposit} from "@chainsafe/lodestar-types";
import {List, Vector, toHexString} from "@chainsafe/ssz";

describe("test building tree from scratch or recycle", function () {
  this.timeout("2 min");

  const config = getMedallaConfig();

  const valueCount = 160;
  const initialValueCount = 100000;
  const initialValues = generateRandomRoots(initialValueCount);
  const values = generateRandomRoots(valueCount);
  let rootsFromRecycling: any[] = [];

  it("Should build tree and compute roots recycling tree", async function () {
    const labelInitial = `Initial tree for ${initialValueCount} values`;
    console.time(labelInitial);
    const depositRootTree = config.types.DepositDataRootList.tree.createValue(initialValues);
    console.timeEnd(labelInitial);

    const label = `push and root of ${valueCount} values`;
    console.time(label);

    values.forEach((value, i) => {
      depositRootTree.push(value);
      const gindex = depositRootTree.gindexOfProperty(i).toString(10);
      const root = toHexString(depositRootTree.hashTreeRoot());
      // console.log({i, gindex, root});
      rootsFromRecycling.push(root);
    });

    console.timeEnd(label);
  });

  it("Should build tree and compute roots with new trees", async function () {
    const label = `push and root of ${valueCount} values`;
    console.time(label);

    const rootsFromNew: any[] = [];
    values.forEach((value, i) => {
      const valuesSubset = (values as Uint8Array[]).slice(0, i + 1) as List<Vector<number>>;
      // @ts-ignore
      const depositRootTree = config.types.DepositDataRootList.tree.createValue([...initialValues, ...valuesSubset]);

      const gindex = depositRootTree.gindexOfProperty(i).toString(10);
      const root = toHexString(depositRootTree.hashTreeRoot());
      // console.log({i, gindex, root});
      rootsFromNew.push(root);
    });

    expect(rootsFromNew).to.deep.equal(rootsFromRecycling);

    console.timeEnd(label);
  });
});

function generateRandomRoots(num: number): List<Vector<number>> {
  const roots = ([] as Uint8Array[]) as List<Vector<number>>;
  for (let i = 0; i < num; i++) {
    roots.push(Buffer.alloc(32, i));
  }
  return roots;
}

function generateRandomDeposit(index: number): IDepositEvent {
  return {
    blockNumber: index,
    index,
    pubkey: Buffer.alloc(64, index),
    withdrawalCredentials: Buffer.alloc(32, index),
    amount: BigInt("3200000000"),
    signature: Buffer.alloc(96, index),
  };
}
