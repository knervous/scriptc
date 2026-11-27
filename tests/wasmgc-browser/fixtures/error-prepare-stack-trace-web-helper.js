export function run() {
  var previous = Error.prepareStackTrace;
  var hook = function (err, frames) { return "hooked:" + frames.length; };
  Error.prepareStackTrace = hook;
  var same = Error.prepareStackTrace === hook;
  Error.prepareStackTrace = previous;
  return [same, typeof hook, Error.prepareStackTrace === previous].join("|");
}
