/**
 * key-reader.ts — Read a secret (API key) from stdin with masked echo.
 *
 * Two modes:
 *   1. Real TTY (production): uses `process.stdin` with raw mode enabled,
 *      intercepts keypress events, displays `*` for each character.
 *   2. Test mode: if `globalThis.__readChar` is set, uses that as a fake
 *      input source. Lets tests inject keys without TTY.
 *
 * Why a separate module? Ink (the TUI library) takes over stdin, so we
 * need raw mode control + write-to-stdout for the echo.
 *
 * Returns the real key value (not the masked display).
 */

export interface KeyReaderOptions {
  /** Prompt prefix displayed before the masked input */
  prompt?: string;
  /** Called on each character for live display (mask, buffer) */
  onEcho?: (mask: string, buffer: string) => void;
  /** Optional custom char reader (defaults to TTY) */
  readChar?: () => Promise<string>;
  /** Optional output sink (defaults to process.stdout.write) */
  write?: (s: string) => void;
}

/**
 * Default: read a single char from stdin (TTY, raw mode).
 * Used in production; tests inject their own.
 */
async function readCharTTY(): Promise<string> {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    if (!stdin.isTTY) {
      // Non-TTY (piped): read a line
      let buf = '';
      const onData = (chunk: Buffer) => {
        const s = chunk.toString('utf8');
        if (s.includes('\n') || s.includes('\r')) {
          stdin.removeListener('data', onData);
          buf += s.split(/[\r\n]/)[0];
          resolve(buf + '\r');
        } else {
          buf += s;
        }
      };
      stdin.on('data', onData);
      return;
    }

    const wasRaw = stdin.isRaw;
    if (!wasRaw) stdin.setRawMode(true);
    stdin.resume();

    const onData = (chunk: Buffer) => {
      const s = chunk.toString('utf8');
      stdin.removeListener('data', onData);
      if (!wasRaw) stdin.setRawMode(false);
      stdin.pause();
      resolve(s);
    };
    stdin.on('data', onData);
  });
}

/**
 * Read a key with masked echo. Returns the actual key.
 *
 * Controls:
 *   - Printable chars: append to buffer, echo '*'
 *   - \r or \n: submit
 *   - \x7f or \b (backspace): remove last char
 *   - \x03 (Ctrl+C): throw to abort
 *   - Other non-printable: ignored
 */
export async function readKeyWithMask(opts: KeyReaderOptions = {}): Promise<string> {
  const prompt = opts.prompt ?? '';
  const onEcho = opts.onEcho ?? (() => {});
  const readChar = opts.readChar ?? (globalThis as any).__readChar ?? readCharTTY;
  const write = opts.write ?? ((s: string) => process.stdout.write(s));

  let buffer = '';

  if (prompt) write(prompt);

  while (true) {
    const k = await readChar();

    // Submit on Enter (\r or \n)
    if (k === '\r' || k === '\n') {
      write('\n');
      return buffer;
    }

    // Ctrl+C → abort
    if (k === '\x03') {
      throw new Error('cancelled');
    }

    // Backspace (\x7f is what raw TTY sends, \b is what piped input sends)
    if (k === '\x7f' || k === '\b') {
      if (buffer.length > 0) {
        buffer = buffer.slice(0, -1);
        // Erase the * on screen: backspace, space, backspace
        write('\b \b');
        onEcho('*'.repeat(buffer.length), buffer);
      }
      continue;
    }

    // Escape sequences (arrow keys, etc.) — skip
    if (k.startsWith('\x1b')) {
      // Read the rest of the escape sequence and discard
      // (TTY sends \x1b[A for up, etc.)
      continue;
    }

    // Single printable char (length 1, not a control char)
    if (k.length === 1 && k.charCodeAt(0) >= 0x20) {
      buffer += k;
      write('*');
      onEcho('*'.repeat(buffer.length), buffer);
    }
  }
}
