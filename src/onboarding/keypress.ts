/**
 * keypress.ts — Robust keyboard input for onboarding steps.
 *
 * Uses Node's built-in `readline.emitKeypressEvents` which handles
 * escape sequences properly (arrow keys, function keys, modifiers).
 * Works across real terminals, PTY, tmux, screen, etc.
 *
 * Returns parsed key events: { name, sequence, ctrl, meta, shift, raw }
 *   - name: 'up' | 'down' | 'left' | 'right' | 'return' | 'escape' | 'space' | char | ...
 *   - sequence: raw escape sequence string
 *   - ctrl/meta/shift: boolean modifiers
 *
 * For printable chars: name is the char itself (e.g. 'a', '/', '5')
 * For special keys: name is the key (e.g. 'up', 'return')
 */
import * as readline from 'node:readline';

export interface KeyEvent {
  /** Parsed key name ('up', 'down', 'return', 'escape', or a printable char) */
  name: string;
  /** Raw escape sequence as sent by terminal */
  sequence: string;
  /** Ctrl held */
  ctrl: boolean;
  /** Meta/Alt held */
  meta: boolean;
  /** Shift held */
  shift: boolean;
}

export interface KeypressOptions {
  /** Called for each keypress. Return true to stop listening. */
  onKey: (key: KeyEvent) => boolean | void | Promise<boolean | void>;
  /** Optional abort signal (e.g. timeout) */
  signal?: AbortSignal;
}

/**
 * Wait for the next keypress and call onKey. Loops until onKey returns true.
 * Resolves when the listener is stopped.
 */
export async function listenForKeys(opts: KeypressOptions): Promise<void> {
  const stdin = process.stdin as unknown as {
    isTTY?: boolean;
    isRaw?: boolean;
    setRawMode: (mode: boolean) => void;
    resume: () => void;
    pause: () => void;
    on: (event: string, listener: (...args: any[]) => void) => void;
    removeListener: (event: string, listener: (...args: any[]) => void) => void;
  };

  // Ensure keypress events are emitted
  readline.emitKeypressEvents(stdin as any);

  const wasRaw = !!stdin.isRaw;
  if (stdin.isTTY) stdin.setRawMode(true);
  stdin.resume();

  return new Promise((resolve, reject) => {
    let stopped = false;

    const cleanup = () => {
      if (stopped) return;
      stopped = true;
      stdin.removeListener('keypress', onKeypress);
      if (stdin.isTTY) {
        try {
          stdin.setRawMode(wasRaw || false);
        } catch {
          // ignore
        }
      }
      stdin.pause();
      if (opts.signal) opts.signal.removeEventListener('abort', onAbort);
    };

    const onAbort = () => {
      cleanup();
      reject(new Error('aborted'));
    };
    if (opts.signal) {
      if (opts.signal.aborted) {
        cleanup();
        reject(new Error('aborted'));
        return;
      }
      opts.signal.addEventListener('abort', onAbort);
    }

    const onKeypress = async (str: string | undefined, key: readline.Key) => {
      if (stopped) return;
      if (!key) return;

      // Map the key event to our cleaner format
      const evt: KeyEvent = {
        name: key.name || str || '',
        sequence: key.sequence || str || '',
        ctrl: !!key.ctrl,
        meta: !!key.meta,
        shift: !!key.shift,
      };

      // Special handling for chars — readline gives 'a' for ctrl+a but we want
      // to distinguish printable chars from control sequences
      // For ctrl+c, key.name === 'c' and key.ctrl === true
      // For just 'c', key.name === 'c' and key.ctrl === false

      try {
        const result = await opts.onKey(evt);
        if (result === true) {
          cleanup();
          resolve();
        }
      } catch (err) {
        cleanup();
        reject(err);
      }
    };

    stdin.on('keypress', onKeypress);
  });
}

/**
 * Convenience: read a single keypress and return it.
 */
export async function readKey(): Promise<KeyEvent> {
  return new Promise((resolve, reject) => {
    let resolved = false;
    listenForKeys({
      onKey: (k) => {
        if (!resolved) {
          resolved = true;
          resolve(k);
          return true; // stop
        }
        return false;
      },
    }).catch(reject);
  });
}

/** Predicate helpers */
export const isUp = (k: KeyEvent) =>
  k.name === 'up' || (k.ctrl && k.name === 'p') || (!k.ctrl && !k.meta && k.sequence === '\x1b[A') || k.name === 'k';
export const isDown = (k: KeyEvent) =>
  k.name === 'down' || (k.ctrl && k.name === 'n') || (!k.ctrl && !k.meta && k.sequence === '\x1b[B') || k.name === 'j';
export const isEnter = (k: KeyEvent) => k.name === 'return' || k.name === 'enter' || k.sequence === '\r' || k.sequence === '\n';
export const isEscape = (k: KeyEvent) => k.name === 'escape' || k.sequence === '\x1b';
export const isCtrlC = (k: KeyEvent) => k.ctrl && (k.name === 'c' || k.sequence === '\x03');
export const isChar = (k: KeyEvent) =>
  !k.ctrl && !k.meta && k.name.length === 1 && k.sequence.length === 1;
