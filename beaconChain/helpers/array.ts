/**
 * Takes two arrays and combines them similar to the Array.zip() form Python.
 * a = [1,2,3] b = [4,5,6]
 * c = zip(a,b) // [[1,4], [2,5], [3,6]]
 * NOTE: Lodash would be an alternative, although theres no need *YET* to import lodash for one function.
 * That being said there is one main caveat: if the arrays are not 1-1 in length it will return undefined
 * but, this is fine for our use case since validatorBalances and validators must be 1-1 in length.
 * @param {Array<T>} a
 * @param {Array<X>} b
 * @returns {(T | X)[][]}
 */
function zip<T, X>(a: Array<T>, b: Array<X>): (T|X)[][] {
    return a.map((e,i) => { return [e, b[i]] });
};

export { zip };
