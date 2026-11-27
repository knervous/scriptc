// The same empty patterns in JavaScript (native dyn in the native lanes).
export function jsEmpty(t0) { try { const {} = t0; return "ran"; } catch (e) { return e.name + ": " + e.message; } }
export function jsEmptyNested(t0) { try { const { a: {} } = t0; return "ran"; } catch (e) { return e.name + ": " + e.message; } }
