export var fn = function () { var r = Array.prototype.slice.call(arguments); return (this ? this.k : "none") + ":" + r.length + ":" + r.join(); };
