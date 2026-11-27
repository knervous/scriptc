// @known-defect(engine): engine dyn keeps a caught page value as a page value, and a catch binding's instanceof tests only compiled classes, so a page Error answers false for instanceof Error
// A page rejection is a caught page exception: a page Error (here a
// SyntaxError the program never names) answers instanceof Error and its name.
async function main(): Promise<void> {
  try { console.log(await new Response(null, { status: 200 }).json()); } catch (e) { console.log("rejected", e instanceof Error ? e.name : typeof e, String(e).slice(0, 11)); }
}
void main();
