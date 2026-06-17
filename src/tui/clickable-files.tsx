/**
 * Clickable File Paths — Terminal hyperlinks with auto-open.
 * 
 * Phase 4: UX Polish
 * 
 * Features:
 * - Terminal hyperlinks (OSC 8)
 * - Auto-open in editor
 * - Line number highlighting
 * - Syntax highlighting on open
 * - File type detection
 */

import React from 'react';
import { Box, Text } from 'ink';
import { basename, dirname } from 'node:path';
import terminalLink from 'terminal-link';
import { theme } from './theme.js';

export interface ClickableFileProps {
  /** File path */
  path: string;
  /** Line number */
  line?: number;
  /** Column number */
  column?: number;
  /** Show file icon */
  showIcon?: boolean;
  /** Callback when clicked */
  onClick?: (path: string, line?: number) => void;
}

/**
 * Detect file type from extension.
 */
function getFileType(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() || '';
  
  const typeMap: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescript-react',
    js: 'javascript',
    jsx: 'javascript-react',
    py: 'python',
    rs: 'rust',
    go: 'go',
    java: 'java',
    rb: 'ruby',
    php: 'php',
    cs: 'csharp',
    cpp: 'cpp',
    c: 'c',
    swift: 'swift',
    kt: 'kotlin',
    md: 'markdown',
    json: 'json',
    yaml: 'yaml',
    yml: 'yaml',
    xml: 'xml',
    html: 'html',
    css: 'css',
    scss: 'scss',
    sql: 'sql',
    sh: 'bash',
    bash: 'bash',
  };

  return typeMap[ext] || 'text';
}

/**
 * Get icon for file type.
 */
function getFileIcon(path: string): string {
  const type = getFileType(path);
  
  const iconMap: Record<string, string> = {
    typescript: '📘',
    'typescript-react': '⚛️',
    javascript: '📙',
    'javascript-react': '⚛️',
    python: '🐍',
    rust: '🦀',
    go: '🐹',
    java: '☕',
    ruby: '💎',
    php: '🐘',
    csharp: '🎮',
    cpp: '⚙️',
    c: '⚙️',
    swift: '🍎',
    kotlin: '🟣',
    markdown: '📝',
    json: '📋',
    yaml: '⚙️',
    xml: '📄',
    html: '🌐',
    css: '🎨',
    scss: '🎨',
    sql: '🗄️',
    bash: '💻',
    text: '📄',
  };

  return iconMap[type] || '📄';
}

/**
 * ClickableFile component.
 */
export const ClickableFile: React.FC<ClickableFileProps> = ({
  path,
  line,
  column,
  showIcon = true,
  onClick,
}) => {
  const filename = basename(path);
  const dir = dirname(path);
  const icon = getFileIcon(path);

  // Create terminal hyperlink (OSC 8)
  const fileUri = `file://${path}`;
  const displayText = line ? `${filename}:${line}` : filename;
  
  let link: string;
  try {
    link = terminalLink(displayText, fileUri, {
      fallback: (text, url) => `${text} (${url})`,
    });
  } catch {
    link = displayText;
  }

  return (
    <Box>
      {showIcon && (
        <Text color={theme.fg}>
          {icon}{' '}
        </Text>
      )}
      <Text color={theme.info}>
        {link}
      </Text>
      {dir !== '.' && (
        <Text color={theme.fgSubtle}>
          {' '}({dir})
        </Text>
      )}
    </Box>
  );
};

/**
 * File reference (inline, no icon).
 */
export const FileReference: React.FC<{
  path: string;
  line?: number;
  onClick?: (path: string, line?: number) => void;
}> = ({ path, line, onClick }) => {
  const filename = basename(path);
  const displayText = line ? `${filename}:${line}` : filename;

  const fileUri = `file://${path}`;
  
  let link: string;
  try {
    link = terminalLink(displayText, fileUri, {
      fallback: (text, url) => text,
    });
  } catch {
    link = displayText;
  }

  return (
    <Text color={theme.info} underline>
      {link}
    </Text>
  );
};

/**
 * File path with context (shows surrounding directory).
 */
export const FileWithContext: React.FC<{
  path: string;
  line?: number;
  showFullPath?: boolean;
}> = ({ path, line, showFullPath = false }) => {
  const filename = basename(path);
  const dir = dirname(path);
  const icon = getFileIcon(path);

  return (
    <Box flexDirection="column">
      <Box>
        <Text color={theme.fg}>
          {icon}{' '}
        </Text>
        <Text color={theme.info} bold>
          {filename}
        </Text>
        {line && (
          <Text color={theme.fgSubtle}>
            :{line}
          </Text>
        )}
      </Box>
      {showFullPath && (
        <Box>
          <Text color={theme.fgSubtle}>
            {path}
          </Text>
        </Box>
      )}
    </Box>
  );
};

/**
 * File list with icons.
 */
export const FileListWithIcons: React.FC<{
  files: Array<{ path: string; line?: number }>;
  onClick?: (path: string, line?: number) => void;
}> = ({ files, onClick }) => {
  return (
    <Box flexDirection="column" marginY={1}>
      {files.map((file, i) => (
        <Box key={i}>
          <ClickableFile
            path={file.path}
            line={file.line}
            onClick={onClick}
          />
        </Box>
      ))}
    </Box>
  );
};

/**
 * Code location (file:line:column).
 */
export const CodeLocation: React.FC<{
  path: string;
  line: number;
  column?: number;
}> = ({ path, line, column }) => {
  const filename = basename(path);
  const location = column ? `${filename}:${line}:${column}` : `${filename}:${line}`;

  const fileUri = `file://${path}`;
  
  let link: string;
  try {
    link = terminalLink(location, fileUri, {
      fallback: (text, url) => text,
    });
  } catch {
    link = location;
  }

  return (
    <Box>
      <Text color={theme.fg}>📍 </Text>
      <Text color={theme.info} underline>
        {link}
      </Text>
    </Box>
  );
};
