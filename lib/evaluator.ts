import { getQuickJS } from "quickjs-emscripten";
import { evaluateInSandbox } from "@/lib/player-evaluator";

// Node/Vercel loader. Wrangler aliases this module to cloudflare/evaluator.ts.
export async function evaluatePlayer(output: string): Promise<Record<string, string>> {
  return evaluateInSandbox(output, await getQuickJS());
}
