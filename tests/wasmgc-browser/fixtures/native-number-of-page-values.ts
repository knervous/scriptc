// @options: {"hostHandles": true}
// Number(x) and Number.isFinite(x) over page values (an event's fields, a URL's parts): on the native host they convert with
// the compiled ToNumber and number test, never through the page's `Number` global (a native host has none).
const ev = new Event("ping");
const url = new URL("http://example.test:8080/a?n=42&f=%202.5%20");
console.log(Number(ev.bubbles), Number(url.port), Number(url.searchParams.get("n")), Number(url.searchParams.get("f")), Number(url.searchParams.get("none")));
const values: unknown[] = [url.port, ev.bubbles, url.searchParams.get("n"), 7, url.hash];
console.log(values.map((v) => Number(v)).join("|"), values.map((v) => Number.isFinite(v)).join("|"));
