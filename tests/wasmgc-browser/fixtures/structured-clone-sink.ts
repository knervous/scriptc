// @native-any-only: compiled records crossing to structured-clone sinks (postMessage) as plain page data
// A compiled record or array passed to postMessage crosses as a facade Proxy, which the browser cannot clone: the sink receives the value's plain data.
export {};
interface Msg { type: string; pad: number; tags: string[]; nested: { ok: boolean; score: number } }
const a = new BroadcastChannel("sink-test");
const b = new BroadcastChannel("sink-test");
const received: string[] = [];
b.onmessage = (event: MessageEvent) => {
  received.push(JSON.stringify(event.data));
  if (received.length === 3) {
    console.log(received.join("\n"));
    a.close();
    b.close();
  }
};
const msg: Msg = { type: "claim", pad: 2, tags: ["x", "y"], nested: { ok: true, score: 1.5 } };
a.postMessage(msg);
a.postMessage([1, 2, 3].map((n) => n * 2));
const anyMsg: any = JSON.parse('{"k":[1,{"z":null}],"s":"t"}');
a.postMessage(anyMsg);
