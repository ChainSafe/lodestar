var exports = module.exports = {};

class SpecialRecord {

    var fields = {
      // Kind
      'kind' : 'uint8',
      // Data
      'data': ['bytes']
    };

    var defaults = {
      'kind': 0,
      'data': new Buffer()
    };

    /*
    * Takes in an object with the fields that need to be initialized.
    * If a field is not initialized, it will use the default as in this.defaults
    */
    constructor(var toSet) {
      for (var key in fields) {
        if(fields.hasOwnProperty(key)) {
          if(toSet.hasOwnProperty(key)) {
            this.key = toSet.key;
          } else {
            this.key = defaults.key;
          }
        }
      }

    }

}

exports.SpecialRecord = SpecialRecord;
