export const pair = {
 outer: function(cb) { cb(); return this.n; },
 inner: function() { return this.n; }
};
