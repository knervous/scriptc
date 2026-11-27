// react-dom's describeNativeComponentFrame: var previousPrepareStackTrace = Error.prepareStackTrace; Error.prepareStackTrace = void 0; ... restore.
export function run() {
  var previous = Error.prepareStackTrace;
  Error.prepareStackTrace = void 0;
  Error.prepareStackTrace = previous;
  return typeof previous;
}
