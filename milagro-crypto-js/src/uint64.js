/*
    Licensed to the Apache Software Foundation (ASF) under one
    or more contributor license agreements.  See the NOTICE file
    distributed with this work for additional information
    regarding copyright ownership.  The ASF licenses this file
    to you under the Apache License, Version 2.0 (the
    "License"); you may not use this file except in compliance
    with the License.  You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

    Unless required by applicable law or agreed to in writing,
    software distributed under the License is distributed on an
    "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
    KIND, either express or implied.  See the License for the
    specific language governing permissions and limitations
    under the License.
*/

/* rudimentary unsigned 64-bit type for SHA384 and SHA512 */

var UInt64 = function() {
    "use strict";

    var UInt64 = function(top, bot) {
        this.top = top;
        this.bot = bot;
    };

    UInt64.prototype = {
        add: function(y) {
            var t = (this.bot >>> 0) + (y.bot >>> 0),
                low = t >>> 0,
                high = (this.top >>> 0) + (y.top >>> 0);

            this.bot = low;

            if (low != t) {
                this.top = (high + 1) >>> 0;
            } else {
                this.top = high;
            }

            return this;
        },

        copy: function() {
            var r = new UInt64(this.top, this.bot);
            return r;
        },

        shlb: function() {
            var t = this.bot >>> 24;
            this.top = t + (this.top << 8);
            this.bot <<= 8;
            return this;
        }
    };

    return UInt64;
};

if (typeof module !== "undefined" && typeof module.exports !== "undefined") {
    module.exports = {
        UInt64: UInt64
    };
}
