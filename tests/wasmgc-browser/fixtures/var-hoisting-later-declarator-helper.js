// react-dom's shape: a later declarator of the same `var` statement reads an earlier one (stored by then, so the
// binding keeps its plain storage), while a call before a separate statement still reads that one's var as undefined.
function isMedia(t) { return mediaEventTypes.indexOf(t) >= 0; }
function early() { return typeof lateCount; }
export const before = early();
var mediaEventTypes = "abort canplay ended".split(" "),
  nonDelegatedEvents = "cancel close".split(" ").concat(mediaEventTypes);
var lateCount = 3;
export const report = [isMedia("ended"), isMedia("x"), nonDelegatedEvents.length, nonDelegatedEvents.indexOf("abort") >= 0, early()].join(" ");
