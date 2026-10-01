import { getQuickJS } from "quickjs-emscripten";

// Run extracted player code in a WASM interpreter, NOT new Function / node:vm.
// No process, filesystem, network, module loader, or host callbacks are exposed.
export async function evaluatePlayer(output: string): Promise<Record<string, string>> {
  if (output.length > 2_000_000) throw new Error("Player script too large");
  const engine = await getQuickJS();
  const runtime = engine.newRuntime();
  runtime.setMemoryLimit(64 * 1024 * 1024);
  runtime.setMaxStackSize(1024 * 1024);
  const deadline = Date.now() + 2500;
  runtime.setInterruptHandler(() => Date.now() > deadline);
  const context = runtime.newContext();
  try {
    const result = context.evalCode(output);
    if (result.error) {
      result.error.dispose();
      throw new Error("Player evaluation failed");
    }
    try {
      const values: Record<string, string> = {};
      for (const name of ["sig", "n"]) {
        const property = context.getProp(result.value, name);
        try {
          if (context.typeof(property) === "string") {
            const value = context.getString(property);
            if (value.length > 10000) throw new Error("Invalid player result");
            values[name] = value;
          }
        } finally { property.dispose(); }
      }
      return values;
    } finally { result.value.dispose(); }
  } finally {
    context.dispose();
    runtime.dispose();
  }
}
