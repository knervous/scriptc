// @plain-native-only: TS `any` is a page value in the plain native lane; arrays and class instances cross to it as copies / facades
// A hole in an array held as `any` stays absent (`in`, Object.keys, JSON), and Object.getPrototypeOf(x).constructor names the instance's class.
function id(v: any): any { return v; }
const holes = [1, , 3];
const x = id(holes);
console.log(1 in x, 0 in x, Object.keys(x).join(","), x.length, JSON.stringify(x));
const grown: (number | undefined)[] = [];
grown.length = 3;
grown[0] = 1;
const y = id(grown);
console.log(1 in y, 0 in y, Object.keys(y).join(","), y.length);
class A { a = 1; }
class B extends A { b = 2; }
const a = id(new A()), b = id(new B());
console.log(Object.getPrototypeOf(a).constructor.name, Object.getPrototypeOf(b).constructor.name, a.constructor.name, b.constructor.name);
console.log(Object.getPrototypeOf(id([])).constructor.name, Object.getPrototypeOf(id({})).constructor.name);
