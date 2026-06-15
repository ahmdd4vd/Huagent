/**
 * Read .env file helper.
 */
import * as fs from "node:fs/promises";

export async function loadEnv(path: string = "/root/.hermes/.env"): Promise<Record<string, string>> {
  try {
    const content = await fs.readFile(path, "utf-8");
    const env: Record<string, string> = {};
    for (const line of content.split("\n")) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (m) env[m[1]] = m[2].trim();
    }
    return env;
  } catch {
    return {};
  }
}
