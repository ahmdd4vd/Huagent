/**
 * Syntax Highlighter — Code blocks dengan syntax highlighting.
 * 
 * Phase 3: TUI Polish
 * 
 * Features:
 * - Syntax highlighting dengan cli-highlight
 * - Support multiple languages (TypeScript, JavaScript, Python, etc.)
 * - Auto-detect language
 * - Line numbers (optional)
 * - Theme-aware colors
 */

import React from 'react';
import { Box, Text } from 'ink';
import hl from 'cli-highlight';
import { theme } from './theme.js';

export interface SyntaxHighlighterProps {
  /** Code to highlight */
  code: string;
  /** Language (auto-detect if not provided) */
  language?: string;
  /** Show line numbers */
  lineNumbers?: boolean;
  /** Max width */
  width?: number;
}

/**
 * Detect language dari code content.
 */
function detectLanguage(code: string): string {
  // TypeScript/JavaScript detection
  if (/import\s+.*?from\s+['"]/.test(code) || /export\s+(const|function|class)/.test(code)) {
    return 'typescript';
  }
  if (/function\s+\w+\s*\(/.test(code) || /const\s+\w+\s*=/.test(code)) {
    return 'javascript';
  }

  // Python detection
  if (/def\s+\w+\s*\(/.test(code) || /import\s+\w+/.test(code) || /print\s*\(/.test(code)) {
    return 'python';
  }

  // Rust detection
  if (/fn\s+\w+\s*\(/.test(code) || /let\s+mut\s+/.test(code)) {
    return 'rust';
  }

  // Go detection
  if (/func\s+\w+\s*\(/.test(code) || /package\s+\w+/.test(code)) {
    return 'go';
  }

  // Shell/Bash detection
  if (/^\s*#!\/bin\/(ba)?sh/.test(code) || /^\s*echo\s+/.test(code)) {
    return 'bash';
  }

  // JSON detection
  if (/^\s*\{[\s\S]*\}\s*$/.test(code) && /".*?":/.test(code)) {
    return 'json';
  }

  // Default to text
  return 'text';
}

/**
 * Add line numbers to code.
 */
function addLineNumbers(code: string, startLine: number = 1): string {
  const lines = code.split('\n');
  const maxLineNum = startLine + lines.length - 1;
  const padding = String(maxLineNum).length;

  return lines
    .map((line, i) => {
      const lineNum = String(startLine + i).padStart(padding, ' ');
      return `${lineNum} │ ${line}`;
    })
    .join('\n');
}

/**
 * SyntaxHighlighter component.
 */
export const SyntaxHighlighter: React.FC<SyntaxHighlighterProps> = ({
  code,
  language,
  lineNumbers = false,
  width,
}) => {
  // Detect language if not provided
  const lang = language || detectLanguage(code);

  // Add line numbers if enabled
  const codeWithLines = lineNumbers ? addLineNumbers(code) : code;

  try {
    // Highlight code
    const highlighted = hl(codeWithLines, {
      language: lang,
      ignoreIllegals: true,
    });

    // Parse highlighted HTML to Ink-compatible format
    // cli-highlight returns HTML, we need to convert ANSI codes
    const lines = highlighted.split('\n');

    return (
      <Box flexDirection="column" width={width}>
        {/* Language badge */}
        <Box marginBottom={0}>
          <Text color={theme.fgSubtle}>
            {lang}
          </Text>
        </Box>

        {/* Code block */}
        <Box
          flexDirection="column"
          borderStyle="round"
          borderColor={theme.border}
          paddingX={1}
          width={width}
        >
          {lines.map((line, i) => (
            <Text key={i} wrap="truncate">
              {line}
            </Text>
          ))}
        </Box>
      </Box>
    );
  } catch (error) {
    // Fallback to plain text if highlighting fails
    return (
      <Box flexDirection="column" width={width}>
        <Box marginBottom={0}>
          <Text color={theme.fgSubtle}>
            {lang} (plain)
          </Text>
        </Box>
        <Box
          flexDirection="column"
          borderStyle="round"
          borderColor={theme.border}
          paddingX={1}
          width={width}
        >
          <Text color={theme.fg}>{code}</Text>
        </Box>
      </Box>
    );
  }
};

/**
 * Inline code (single line).
 */
export const InlineCode: React.FC<{ code: string }> = ({ code }) => {
  return (
    <Text color={theme.sakura} backgroundColor={theme.bgElevated}>
      {' '}{code}{' '}
    </Text>
  );
};

/**
 * Code block wrapper (multi-line).
 */
export const CodeBlock: React.FC<{
  code: string;
  language?: string;
  lineNumbers?: boolean;
  filename?: string;
}> = ({ code, language, lineNumbers = false, filename }) => {
  return (
    <Box flexDirection="column" marginY={1}>
      {filename && (
        <Box marginBottom={0}>
          <Text color={theme.fg} bold>
            📄 {filename}
          </Text>
        </Box>
      )}
      <SyntaxHighlighter
        code={code}
        language={language}
        lineNumbers={lineNumbers}
      />
    </Box>
  );
};
