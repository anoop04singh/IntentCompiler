import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";

export async function run(
  command: string,
  args: string[],
  options: {
    cwd: string;
    env?: NodeJS.ProcessEnv;
    timeoutMs?: number;
    signal?: AbortSignal;
    logPath?: string;
  },
): Promise<string> {
  return new Promise((resolve, reject) => {
    const log = options.logPath
      ? createWriteStream(options.logPath, { flags: "a", mode: 0o600 })
      : undefined;
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      shell: false,
      windowsHide: true,
      signal: options.signal,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    let overflow = false;
    const timeout = setTimeout(
      () => child.kill("SIGKILL"),
      options.timeoutMs ?? 900000,
    );
    for (const stream of [child.stdout, child.stderr])
      stream.on("data", (chunk: Buffer) => {
        log?.write(chunk);
        output += chunk.toString();
        if (output.length > 8_000_000) {
          overflow = true;
          child.kill("SIGKILL");
        }
      });
    child.on("error", (error) => {
      clearTimeout(timeout);
      log?.end();
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      log?.end();
      if (code === 0 && !overflow) resolve(output);
      else
        reject(
          new Error(
            `Command ${command.split(/[\\/]/).pop()} failed (exit ${code}); inspect private worker logs`,
          ),
        );
    });
  });
}
