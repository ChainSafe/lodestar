/**
 * This script test NodeJS behaviour to decide which WeakRefs to GC.
 * For both v14 and v16 NodeJS strictly GCs WeakRefs by order of creation, regardless of usage.
 *
 * This script creates 350MB arrays and inserts then into a Map wrapped with a WeakRef.
 * If deref() values 0 and 1 to check if usage delays GC. However running this script yields
 *
 * ```
 * 0 - heapUsed 127.859328 MB
 * Used 0
 * 1 - heapUsed 473.8622 MB
 * Used 0
 * Used 1
 * 2 - heapUsed 589.052368 MB
 * Used 0
 * Used 1
 * 3 - heapUsed 875.18052 MB
 * Used 0
 * Used 1
 * 4 - heapUsed 1161.331344 MB
 * expired 0
 * expired 1
 * expired 2
 * 5 - heapUsed 359.572248 MB
 * 6 - heapUsed 645.6928 MB
 * 7 - heapUsed 931.81108 MB
 * 8 - heapUsed 1217.929616 MB
 * 9 - heapUsed 1504.047864 MB
 * 10 - heapUsed 1790.1756 MB
 * expired 3
 * expired 4
 * expired 5
 * expired 6
 * expired 7
 * expired 8
 * ```
 */
/* eslint-disable no-console */
async function testFn(): Promise<void> {
  const weakRefs = new Map<number, WeakRef<number[]>>();

  for (let i = 0; i < 1000; i++) {
    const heapUsedMB = process.memoryUsage().heapUsed / 1e6;
    console.log(`${i} - heapUsed ${heapUsedMB} MB`);
    const largeObj = getLargeObject();
    const newWeakRef = new WeakRef(largeObj);
    weakRefs.set(i, newWeakRef);

    // Must yield to the macro queue to allow creating an actual WeakRef
    // Using setTimeout(r, 0) results in a much latter GC of WeakRefs
    await new Promise((r) => setTimeout(r, 10));

    // Use some refs to test if they are deleted latter
    useRefs(weakRefs, [0, 1]);
    await new Promise((r) => setTimeout(r, 10));

    // Check which weakRefs have expired
    checkRefs(weakRefs);
    // MUST yield after .deref() or the strong refs are not dropped causing OOM
    await new Promise((r) => setTimeout(r, 10));
  }
}

function useRefs(weakRefs: Map<number, WeakRef<number[]>>, idxs: number[]): void {
  for (const idx of idxs) {
    const val = weakRefs.get(idx)?.deref();
    if (val) console.log(`Used ${idx}`);
  }
}

function checkRefs(weakRefs: Map<number, WeakRef<number[]>>): void {
  // Check which weakRefs have expired
  for (const [idx, weakRef] of weakRefs) {
    const value = weakRef.deref();
    if (value === undefined) {
      weakRefs.delete(idx);
      console.log(`GC'ed ${idx}`);
    }
  }
}

function getLargeObject(): number[] {
  const arr: number[] = [];
  for (let i = 0; i < 1e7; i++) {
    arr.push(i);
  }
  return arr;
}

testFn().catch((e) => {
  console.error(e);
  process.exit(1);
});
