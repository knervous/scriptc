export function report() {
  const out = [];
  function factory() {
    function read() { return hasMemo; }
    out.push(String(read()));
    var hasMemo = false;
    out.push(String(read())); hasMemo = true; out.push(String(read()));
    return read;
  }
  const f = factory(); out.push(String(f())); return out.join('|');
}
