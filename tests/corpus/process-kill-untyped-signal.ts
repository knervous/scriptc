// process.kill with a signal whose type is not a number or a string: Node's run-time dispatch (a number is the
// signal, 0 probes; an unknown name throws ERR_UNKNOWN_SIGNAL; a BigInt throws).
function kill(pid: number, signal: unknown): string {
  try {
    return `ok ${process.kill(pid, signal as any)}`;
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    return `${err.name} ${err.code ?? ""} ${err.message}`;
  }
}

const signals: unknown[] = [0, "SIGNOPE", "0", 10n, { toString: () => "SIGBOGUS" }];
for (const signal of signals) console.log(typeof signal, kill(process.pid, signal));
const union: string | number = Math.random() < 2 ? 0 : "SIGTERM";
console.log("union", process.kill(process.pid, union));
