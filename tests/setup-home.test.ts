import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
const directories: string[] = [];
const script = resolve("scripts/setup-home.mjs");
function run(content?: string) {
  const directory = mkdtempSync(join(tmpdir(), "relay-home-")); directories.push(directory);
  if (content !== undefined) writeFileSync(join(directory, ".env.local"), content);
  const env = { ...process.env };
  for (const key of ["ACCESS_PASSWORD", "AUTH_SECRET", "HOME_BACKEND_KEY", "RELAY_MODE", "__NEXT_PROCESSED_ENV"]) delete env[key];
  const child = spawnSync(process.execPath, [script], { cwd: directory, env, encoding: "utf8" });
  return { directory, child, file: () => readFileSync(join(directory, ".env.local"), "utf8") };
}
afterEach(() => { for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true }); });
describe("non-destructive home setup", () => {
  it("preserves short passwords, the existing auth secret and unrelated configuration", () => {
    const original = 'ACCESS_PASSWORD="abc"\nAUTH_SECRET=existing-auth-secret-at-least-32-characters\nRELAY_MODE=frontend\n# My configuration\n';
    const result = run(original);
    expect(result.child.status).toBe(0); expect(result.file().startsWith(original)).toBe(true);
    expect(result.file()).toMatch(/HOME_BACKEND_KEY=[a-f0-9]{64}/);
    expect(result.child.stdout).not.toContain("existing-auth-secret-at-least-32-characters");
    const before = result.file();
    const env = { ...process.env }; for (const key of ["ACCESS_PASSWORD", "AUTH_SECRET", "HOME_BACKEND_KEY", "__NEXT_PROCESSED_ENV"]) delete env[key];
    const again = spawnSync(process.execPath, [script], { cwd: result.directory, env, encoding: "utf8" });
    expect(again.status).toBe(0); expect(result.file()).toBe(before);
  });
  it("fills blank example fields rather than appending duplicate assignments", () => {
    const result = run('ACCESS_PASSWORD=abc\nAUTH_SECRET=existing-auth-secret-at-least-32-characters\nHOME_BACKEND_KEY=""\n');
    expect(result.child.status).toBe(0); expect(result.file().match(/HOME_BACKEND_KEY=/g)).toHaveLength(1);
    expect(result.file()).toMatch(/HOME_BACKEND_KEY=[a-f0-9]{64}/);
  });
  it("creates new credentials without printing their values", () => {
    const result = run(); expect(result.child.status).toBe(0);
    for (const line of result.file().trim().split("\n")) {
      expect(line.split("=")[1].length).toBeGreaterThan(0);
      expect(result.child.stdout).not.toContain(line.split("=")[1]);
    }
  });
  it("does not overwrite an existing, invalid secret", () => {
    const original = "ACCESS_PASSWORD=abc\nAUTH_SECRET=short\n";
    const result = run(original); expect(result.child.status).toBe(1); expect(result.file()).toBe(original);
  });
});
