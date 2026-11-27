// A typed fetch() under each host set (host-island-generic.test.ts): a data: URL and a blob: URL, which every set
// answers from memory, and an http URL of the lane's own server (its port in the page's query), which only a set with
// the network reaches. Without it the fetch rejects with fetch's TypeError, as a browser offline.
const port = new URLSearchParams(location.search).get("port");

async function main(): Promise<void> {
  const d = await fetch("data:text/plain;charset=utf-8,hi%20there");
  console.log("data", d.status, d.headers.get("content-type"), await d.text());
  const url = URL.createObjectURL(new Blob(["blob body"], { type: "text/plain" }));
  const b = await fetch(url);
  console.log("blob", b.status, b.headers.get("content-type"), await b.text());
  try {
    const r = await fetch(`http://127.0.0.1:${port}/hello`);
    console.log("http", r.status, await r.text());
  } catch (e) {
    const err = e as Error;
    console.log("http rejected", e instanceof TypeError, e instanceof Error, err.name, err.message);
  }
  // The same request's rejection read by an `any` callback of the typed promise: the program's Error of that rejection,
  // seen as a page value.
  await fetch(`http://127.0.0.1:${port}/hello`).then(
    (r) => console.log("then", r.status),
    (e: any) => console.log("then rejected", e instanceof TypeError, e instanceof Error, e.name, e.message),
  );
}

main();
