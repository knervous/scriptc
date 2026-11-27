// An untyped write of a TypeScript class's zero-argument method: the program observes `notify` from here.
export function replaceNotify(target, fn) {
  target.notify = fn;
}
