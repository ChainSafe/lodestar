import {itBench} from "@dapplion/benchmark";

describe("misc / Map", () => {
  const times = 1000;

  type ObjData = {obj: Record<string, number>; keys: string[]};
  type MapData = {map: Map<string, number>; keys: string[]};

  itBench({
    id: "Object access 1 prop",
    runsFactor: times,
    beforeEach: () => ({a: 1}),
    fn: (obj) => {
      obj.a;
    },
  });

  itBench({
    id: "Map access 1 prop",
    runsFactor: times,
    beforeEach: () => new Map([["a", 1]]),
    fn: (map) => {
      map.get("a");
    },
  });

  itBench<ObjData, ObjData>({
    id: `Object get x${times}`,
    runsFactor: times,
    before: () => {
      const obj: Record<string, number> = {};
      const keys: string[] = [];
      for (let i = 0; i < times; i++) {
        const key = String("key" + i);
        keys.push(key);
        obj[key] = i;
      }
      return {obj, keys};
    },
    beforeEach: (data) => data,
    fn: ({obj, keys}) => {
      for (let i = 0; i < times; i++) {
        obj[keys[i]];
      }
    },
  });

  itBench<MapData, MapData>({
    id: `Map get x${times}`,
    runsFactor: times,
    before: () => {
      const map = new Map<string, number>();
      const keys: string[] = [];
      for (let i = 0; i < times; i++) {
        const key = String("key" + i);
        keys.push(key);
        map.set(key, i);
      }
      return {map, keys};
    },
    beforeEach: (data) => data,
    fn: ({map, keys}) => {
      for (let i = 0; i < times; i++) {
        map.get(keys[i]);
      }
    },
  });

  itBench<ObjData, ObjData>({
    id: `Object set x${times}`,
    runsFactor: times,
    before: () => {
      const keys: string[] = [];
      for (let i = 0; i < times; i++) {
        const key = String("key" + i);
        keys.push(key);
      }
      return {obj: {}, keys};
    },
    beforeEach: ({keys}) => ({obj: {}, keys}),
    fn: ({obj, keys}) => {
      for (let i = 0; i < times; i++) {
        obj[keys[i]] = i;
      }
    },
  });

  itBench<MapData, MapData>({
    id: `Map set x${times}`,
    runsFactor: times,
    before: () => {
      const keys: string[] = [];
      for (let i = 0; i < times; i++) {
        const key = String("key" + i);
        keys.push(key);
      }
      return {map: new Map(), keys};
    },
    beforeEach: ({keys}) => ({map: new Map(), keys}),
    fn: ({map, keys}) => {
      for (let i = 0; i < times; i++) {
        map.set(keys[i], i);
      }
    },
  });
});
