import type { QuickJSWASMModule } from "quickjs-emscripten-core";

// No filesystem, networking, module loader or host callbacks are exposed.
export function evaluateInSandbox(output: string, engine: QuickJSWASMModule, memoryBytes = 64 * 1024 * 1024): Record<string, string> {
  if (output.length > 2_000_000) throw new Error("Player script too large");
  const runtime = engine.newRuntime();
  runtime.setMemoryLimit(memoryBytes);
  runtime.setMaxStackSize(1024 * 1024);
  const deadline = Date.now() + 2500;
  let interrupts = 0;
  // Workers' clocks do not advance during synchronous execution. The instruction
  // budget is essential there; the wall-clock deadline also protects Node.
  runtime.setInterruptHandler(() => ++interrupts > 4096 || Date.now() > deadline);
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
