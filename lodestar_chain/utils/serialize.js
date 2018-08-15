var exports = module.exports = {};

const function serialize(obj) {
    return JSON.stringify(obj);
}

const function deserialize(jsonObj) {
    return JSON.parse(jsonObj);
}

const function eq(obj1, obj2) {

}

const function deepcopy(obj) {
    return JSON.parse(JSON.stringify(obj));
}
