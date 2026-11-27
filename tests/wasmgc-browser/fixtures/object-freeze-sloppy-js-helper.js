// Sloppy-mode JavaScript (no directive, not an ES module): a write to a frozen record is silently ignored.
exports.poke = function (target) {
  target.x = 100;
  return target.x;
};
exports.addKey = function (target) {
  target.extra = 1;
  return Object.keys(target).join(",");
};
