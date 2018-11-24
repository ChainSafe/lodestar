var public_key = /** @class */ (function () {
    function public_key(k) {
    }
    ;
    return public_key;
}());
var key = /** @class */ (function () {
    function key() {
    }
    return key;
}());
var field_mod;
var field_element = /** @class */ (function () {
    function field_element(n) {
        this.f = n % field_mod;
    }
    return field_element;
}());
var Signature = /** @class */ (function () {
    function Signature() {
    }
    Signature.prototype.keygen = function () {
        return new public_key(0);
    };
    return Signature;
}());
