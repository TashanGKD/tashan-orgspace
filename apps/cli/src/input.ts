export async function readSingleLine(
  stream: NodeJS.ReadableStream = process.stdin,
): Promise<string> {
  let input = "";
  for await (const chunk of stream) {
    input += String(chunk);
    if (input.length > 1024 * 1024) throw new Error("stdin input exceeds 1 MiB");
  }
  return input.replace(/\r?\n$/, "");
}

export async function promptHidden(prompt: string): Promise<string> {
  if (!process.stdin.isTTY || !process.stderr.isTTY || process.stdin.setRawMode === undefined) {
    throw new Error("secure prompt requires a TTY; use the corresponding --*-stdin option");
  }
  process.stderr.write(prompt);
  const previousRaw = process.stdin.isRaw;
  process.stdin.setRawMode(true);
  process.stdin.resume();
  let value = "";
  try {
    return await new Promise<string>((resolve, reject) => {
      const onData = (chunk: Buffer) => {
        for (const byte of chunk) {
          if (byte === 3) {
            cleanup();
            reject(new Error("input cancelled"));
            return;
          }
          if (byte === 13 || byte === 10) {
            cleanup();
            process.stderr.write("\n");
            resolve(value);
            return;
          }
          if (byte === 8 || byte === 127) {
            value = value.slice(0, -1);
            continue;
          }
          if (byte >= 32 && byte <= 126 && value.length < 4096) value += String.fromCharCode(byte);
        }
      };
      const cleanup = () => process.stdin.off("data", onData);
      process.stdin.on("data", onData);
    });
  } finally {
    process.stdin.setRawMode(previousRaw);
    process.stdin.pause();
  }
}
