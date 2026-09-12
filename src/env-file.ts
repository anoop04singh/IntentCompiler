import { readFile, writeFile } from "node:fs/promises";
// Operator setup only. Keep secret values in the existing ignored .env file.
export async function updateEnv(values: Record<string, string>) {
  let text = await readFile(".env", "utf8");
  for (const [name, value] of Object.entries(values)) {
    if (!/^[A-Z_]+$/.test(name) || /[\r\n]/.test(value))
      throw new Error("Invalid environment entry");
    const re = new RegExp(`^${name}=.*$`, "m");
    text = re.test(text)
      ? text.replace(re, () => `${name}=${value}`)
      : `${text}\n${name}=${value}\n`;
  }
  await writeFile(".env", text, { mode: 0o600 });
}
