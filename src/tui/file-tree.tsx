/**
 * File Tree — Visualisasi struktur project.
 * 
 * Phase 3: TUI Polish
 * 
 * Features:
 * - Tree view dengan icons (📁/📄)
 * - File metadata (size, lines)
 * - Color-coded by type
 * - Expandable/collapsible (interactive)
 * - Git status integration (optional)
 */

import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { readdirSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';
import { theme } from './theme.js';

export interface FileTreeProps {
  /** Root path */
  path: string;
  /** Max depth to show */
  maxDepth?: number;
  /** Show file metadata */
  showMetadata?: boolean;
  /** Show hidden files */
  showHidden?: boolean;
  /** Patterns to ignore */
  ignorePatterns?: string[];
  /** Max width */
  width?: number;
}

export interface TreeNode {
  name: string;
  path: string;
  isDir: boolean;
  size?: number;
  lines?: number;
  children?: TreeNode[];
}

/**
 * Build tree structure from path.
 */
function buildTree(
  path: string,
  depth: number = 0,
  maxDepth: number = 3,
  showHidden: boolean = false,
  ignorePatterns: string[] = ['node_modules', '.git', 'dist', 'build']
): TreeNode | null {
  if (depth > maxDepth) return null;

  const name = basename(path);
  // CRITICAL: statSync throws ENOENT if the path doesn't exist (e.g.
  // a broken symlink or a race where the file was deleted between the
  // readdir and the stat). Wrap in try/catch so the renderer doesn't
  // crash — return null to skip this entry.
  let stats;
  try {
    stats = statSync(path);
  } catch {
    return null;
  }
  const isDir = stats.isDirectory();

  if (!isDir) {
    return {
      name,
      path,
      isDir: false,
      size: stats.size,
      lines: countLines(path),
    };
  }

  // Build children
  const children: TreeNode[] = [];
  try {
    const entries = readdirSync(path, { withFileTypes: true });

    for (const entry of entries) {
      // Skip hidden files
      if (!showHidden && entry.name.startsWith('.')) continue;

      // Skip ignored patterns
      if (ignorePatterns.some(p => entry.name.includes(p))) continue;

      const childPath = join(path, entry.name);
      const childNode = buildTree(
        childPath,
        depth + 1,
        maxDepth,
        showHidden,
        ignorePatterns
      );

      if (childNode) {
        children.push(childNode);
      }
    }

    // Sort: directories first, then files
    children.sort((a, b) => {
      if (a.isDir && !b.isDir) return -1;
      if (!a.isDir && b.isDir) return 1;
      return a.name.localeCompare(b.name);
    });
  } catch (error) {
    // Skip directories we can't read
  }

  return {
    name,
    path,
    isDir: true,
    children,
  };
}

/**
 * Count lines in a file.
 */
function countLines(path: string): number {
  try {
    const content = require('fs').readFileSync(path, 'utf-8');
    return content.split('\n').length;
  } catch {
    return 0;
  }
}

/**
 * Format file size.
 */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * File Tree component.
 */
export const FileTree: React.FC<FileTreeProps> = ({
  path,
  maxDepth = 3,
  showMetadata = true,
  showHidden = false,
  ignorePatterns = ['node_modules', '.git', 'dist', 'build'],
  width,
}) => {
  const tree = buildTree(path, 0, maxDepth, showHidden, ignorePatterns);

  if (!tree) {
    return (
      <Box width={width}>
        <Text color={theme.fgSubtle}>No files found</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" marginY={1} width={width}>
      <TreeNodeComponent node={tree} depth={0} showMetadata={showMetadata} />
    </Box>
  );
};

/**
 * Tree node component (recursive).
 */
const TreeNodeComponent: React.FC<{
  node: TreeNode;
  depth: number;
  showMetadata: boolean;
}> = ({ node, depth, showMetadata }) => {
  const [expanded, setExpanded] = useState(depth < 2);

  useInput((input, key) => {
    // Toggle expand/collapse with Enter or Space
    if (node.isDir && (key.return || input === ' ')) {
      setExpanded(!expanded);
    }
  });

  const indent = '  '.repeat(depth);
  const icon = node.isDir ? '📁' : '📄';
  const color = node.isDir ? theme.info : theme.fg;

  return (
    <Box flexDirection="column">
      <Box>
        <Text color={theme.fgSubtle}>{indent}</Text>
        <Text color={color}>
          {node.isDir && (expanded ? '▼ ' : '▶ ')}
          {icon} {node.name}
        </Text>
        {showMetadata && !node.isDir && node.size && (
          <Text color={theme.fgSubtle}>
            {' '}({formatSize(node.size)}, {node.lines} lines)
          </Text>
        )}
      </Box>

      {node.isDir && expanded && node.children && (
        <Box flexDirection="column">
          {node.children.map((child, i) => (
            <TreeNodeComponent
              key={i}
              node={child}
              depth={depth + 1}
              showMetadata={showMetadata}
            />
          ))}
        </Box>
      )}
    </Box>
  );
};

/**
 * Simple file list (non-interactive).
 */
export const FileList: React.FC<{
  files: string[];
  showMetadata?: boolean;
}> = ({ files, showMetadata = true }) => {
  return (
    <Box flexDirection="column" marginY={1}>
      {files.map((file, i) => {
        const stats = statSync(file);
        const lines = countLines(file);

        return (
          <Box key={i}>
            <Text color={theme.fg}>📄 {basename(file)}</Text>
            {showMetadata && (
              <Text color={theme.fgSubtle}>
                {' '}({formatSize(stats.size)}, {lines} lines)
              </Text>
            )}
          </Box>
        );
      })}
    </Box>
  );
};

/**
 * Directory summary.
 */
export const DirectorySummary: React.FC<{
  path: string;
}> = ({ path }) => {
  const tree = buildTree(path, 0, 1, false);

  if (!tree || !tree.children) {
    return null;
  }

  const dirs = tree.children.filter(c => c.isDir).length;
  const files = tree.children.filter(c => !c.isDir).length;

  return (
    <Box>
      <Text color={theme.fgSubtle}>
        📁 {basename(path)}: {dirs} directories, {files} files
      </Text>
    </Box>
  );
};
