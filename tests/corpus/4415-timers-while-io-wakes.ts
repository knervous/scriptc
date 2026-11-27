// A timer due while every turn's I/O wakes more work (a stream of fetch replies, each starting the next) still fires
// in its turn, as in Node: the loop's timers phase is not skipped for as long as I/O keeps resuming code.
import { createServer } from "node:http";

const server = createServer((_req, res) => {
  res.end("ok");
});

const port = 48415;
server.listen(port, "127.0.0.1", async () => {
  let fired = false;
  let done = 0;
  setTimeout(() => {
    fired = true;
  }, 20);
  const started = Date.now();
  while (!fired && done < 3000 && Date.now() - started < 10000) {
    const r = await fetch(`http://127.0.0.1:${port}/`);
    await r.text();
    done++;
  }
  console.log("the timer fired while the fetches ran:", fired);
  server.close();
});
