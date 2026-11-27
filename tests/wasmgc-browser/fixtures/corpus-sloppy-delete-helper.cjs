function sloppyDelete() {
  const object = JSON.parse("{}");
  Object.defineProperty(object, "fixed", { value: 1 });
  Object.defineProperty(object, "free", { value: 2, configurable: true });
  delete object.fixed;
  const k = "free";
  delete object[k];
  const arr = JSON.parse("[1,2]");
  delete arr.length;
  return [Object.hasOwn(object, "fixed"), object.fixed, Object.hasOwn(object, "free"), arr.length].join(" ");
}
exports.sloppyDelete = sloppyDelete;
