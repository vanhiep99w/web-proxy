import RELEASE_SYNC from "@jitl/quickjs-wasmfile-release-sync";
import wasmModule from "../node_modules/@jitl/quickjs-wasmfile-release-sync/dist/emscripten-module.wasm";
import { newQuickJSWASMModuleFromVariant, newVariant, type QuickJSWASMModule } from "quickjs-emscripten-core";
import { evaluateInSandbox } from "@/lib/player-evaluator";

let engine: Promise<QuickJSWASMModule> | undefined;
export async function evaluatePlayer(output: string): Promise<Record<string, string>> {
  // Import a precompiled module: Workers cannot compile WASM bytes at runtime.
  if (!engine) {
    const pending = newQuickJSWASMModuleFromVariant(newVariant(RELEASE_SYNC, { wasmModule }));
    engine = pending;
    void pending.catch(() => { if (engine === pending) engine = undefined; });
  }
  return evaluateInSandbox(output, await engine, 32 * 1024 * 1024);
}
