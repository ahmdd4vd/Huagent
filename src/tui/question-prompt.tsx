/**
 * QuestionPrompt — OpenCode-style AI-to-user question dialog.
 *
 * The model can pause execution and ask the user one or more
 * multi-option questions. Supports:
 *   - Single question (auto-submit on select)
 *   - Multi question (tabs, confirm tab at the end)
 *   - Multi-select (Space toggles, Enter confirms)
 *   - Single-select (Enter selects + advances)
 *   - Custom input option (free text fallback)
 *
 * Key bindings:
 *   ↑/↓ or k/j     navigate options
 *   Space          toggle (multi-select) or select (single)
 *   Enter          advance / submit
 *   1-9            jump to option N
 *   Tab → / Tab ←  switch question tab
 *   Esc            cancel (returns rejected answer)
 */

import React, { useState, useEffect, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import { theme, glyph, fg } from './theme.js';
import type { QuestionRequest } from '../engine/core.js';

export interface QuestionPromptProps {
  request: QuestionRequest;
  onSubmit: (answers: string[][]) => void;
  onCancel: () => void;
  width?: number;
}

export const QuestionPrompt: React.FC<QuestionPromptProps> = ({
  request,
  onSubmit,
  onCancel,
  width = 80,
}) => {
  const questions = request.questions;
  const singleQuestion = questions.length === 1;
  const isMultiSelect = (i: number) => Boolean(questions[i]?.multiSelect);
  const totalTabs = singleQuestion ? 1 : questions.length + 1; // last tab is "Confirm"

  const [tabIdx, setTabIdx] = useState(0);
  const [cursor, setCursor] = useState(0);
  const [answers, setAnswers] = useState<string[][]>(() => questions.map(() => []));
  const [customInputs, setCustomInputs] = useState<string[]>(() => questions.map(() => ''));
  const [customEditing, setCustomEditing] = useState(false);
  const [customDraft, setCustomDraft] = useState('');

  // Reset cursor when switching tabs
  useEffect(() => {
    setCursor(0);
    setCustomEditing(false);
  }, [tabIdx]);

  const currentQ = questions[tabIdx];
  const onConfirmTab = !singleQuestion && tabIdx === questions.length;
  const options = currentQ?.options ?? [];
  // allowCustom: when there are NO predefined options, the user must be
  // able to type a custom answer. The previous logic was inverted
  // (`!== 0` returned false when options was empty, blocking custom input
  // exactly when it was needed). Fixed: `=== 0` returns true when no
  // options exist, allowing custom input.
  const allowCustom = options.length === 0;
  const onCustom = cursor === options.length && allowCustom;
  const currentAnswer = answers[tabIdx] ?? [];

  // Compute visible tabs (filter "Confirm" if all answered)
  useEffect(() => {
    // Auto-advance past confirm tab if user answered all questions
  }, [tabIdx, answers]);

  useInput((input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }
    // Confirm tab logic
    if (onConfirmTab) {
      if (key.return) {
        // Submit all
        onSubmit(answers);
        return;
      }
      if (key.tab && key.shift) {
        setTabIdx(Math.max(0, tabIdx - 1));
        return;
      }
      if (key.tab || key.rightArrow) {
        // Already on confirm, do nothing
        return;
      }
      return;
    }
    // Tab navigation
    if (key.tab && key.shift) {
      setTabIdx(Math.max(0, tabIdx - 1));
      return;
    }
    if (key.tab || key.rightArrow) {
      setTabIdx(Math.min(totalTabs - 1, tabIdx + 1));
      return;
    }
    // Number key jump
    if (input >= '1' && input <= '9' && !customEditing) {
      const n = parseInt(input, 10) - 1;
      if (n < options.length) {
        handleSelect(n);
        return;
      }
    }
    // Custom text input mode
    if (customEditing) {
      if (key.return) {
        // Save custom answer
        if (customDraft.trim()) {
          const newAnswers = [...answers];
          if (isMultiSelect(tabIdx)) {
            if (!newAnswers[tabIdx].includes(customDraft)) {
              newAnswers[tabIdx] = [...newAnswers[tabIdx], customDraft];
            }
          } else {
            newAnswers[tabIdx] = [customDraft];
          }
          setAnswers(newAnswers);
          const newDrafts = [...customInputs];
          newDrafts[tabIdx] = customDraft;
          setCustomInputs(newDrafts);
        }
        setCustomEditing(false);
        setCustomDraft('');
        return;
      }
      if (key.escape) {
        setCustomEditing(false);
        setCustomDraft('');
        return;
      }
      if (key.backspace || key.delete) {
        setCustomDraft((d) => d.slice(0, -1));
        return;
      }
      if (input && !key.ctrl && !key.meta) {
        setCustomDraft((d) => d + input);
        return;
      }
      return;
    }
    // Option navigation
    if (key.upArrow || input === 'k') {
      setCursor((c) => (c <= 0 ? options.length : c - 1));
      return;
    }
    if (key.downArrow || input === 'j') {
      setCursor((c) => (c >= options.length ? 0 : c + 1));
      return;
    }
    // Space: toggle (multi-select) or select+advance (single)
    if (input === ' ') {
      handleSelect(cursor);
      return;
    }
    // Enter: select current
    if (key.return) {
      if (onCustom) {
        setCustomEditing(true);
        setCustomDraft('');
        return;
      }
      handleSelect(cursor);
      return;
    }
  });

  function handleSelect(optionIdx: number) {
    if (onCustom) {
      setCustomEditing(true);
      setCustomDraft('');
      return;
    }
    const opt = options[optionIdx];
    if (!opt) return;
    const newAnswers = [...answers];
    if (isMultiSelect(tabIdx)) {
      const cur = newAnswers[tabIdx] ?? [];
      if (cur.includes(opt.label)) {
        newAnswers[tabIdx] = cur.filter((l) => l !== opt.label);
      } else {
        newAnswers[tabIdx] = [...cur, opt.label];
      }
    } else {
      // Single-select: pick and advance
      newAnswers[tabIdx] = [opt.label];
      // Auto-advance to next tab (or submit if last)
      if (singleQuestion) {
        onSubmit(newAnswers);
        return;
      }
      if (tabIdx < questions.length - 1) {
        setTabIdx(tabIdx + 1);
      } else {
        // Last question answered, jump to confirm
        setTabIdx(questions.length); // confirm tab
      }
    }
    setAnswers(newAnswers);
  }

  const allAnswered = answers.every((a) => a.length > 0);
  const tabLabel = (i: number) => {
    if (i < questions.length) {
      const a = answers[i];
      const answered = a && a.length > 0;
      return `${answered ? '✓' : '○'} Q${i + 1}: ${questions[i].header || questions[i].question.slice(0, 12)}`;
    }
    return `→ Confirm`;
  };

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.info} paddingX={1} width={width}>
      {/* Title bar */}
      <Box>
        <Text color={theme.info} bold>
          {glyph.bullet} Question
        </Text>
        <Text color={theme.fgMuted}>
          {' '}
          — AI is asking for your input
        </Text>
      </Box>
      <Box>
        <Text color={theme.fgSubtle}>{glyph.horz.repeat(width - 4)}</Text>
      </Box>

      {/* Tab strip */}
      {!singleQuestion && (
        <Box flexWrap="wrap">
          {Array.from({ length: totalTabs }).map((_, i) => (
            <Text
              key={i}
              color={i === tabIdx ? theme.primary : i < questions.length && answers[i]?.length ? theme.success : theme.fgSubtle}
              bold={i === tabIdx}
            >
              {i === tabIdx ? ' ▸ ' : '   '}
              {tabLabel(i)}
              {i < totalTabs - 1 ? '   ' : ''}
            </Text>
          ))}
        </Box>
      )}

      <Box marginY={1}>
        <Text color={theme.fgSubtle}>{glyph.horz.repeat(width - 4)}</Text>
      </Box>

      {/* Confirm tab */}
      {onConfirmTab ? (
        <Box flexDirection="column">
          <Box marginBottom={1}>
            <Text color={theme.primary} bold>Review your answers:</Text>
          </Box>
          {questions.map((q, i) => (
            <Box key={i} flexDirection="column" marginBottom={1}>
              <Text color={theme.fgMuted}>Q{i + 1}: {q.question}</Text>
              <Box marginLeft={2}>
                <Text color={theme.success}>
                  {answers[i]?.length ? '→ ' + answers[i].join(', ') : '(no answer)'}
                </Text>
              </Box>
            </Box>
          ))}
          <Box marginTop={1}>
            <Text color={allAnswered ? theme.success : theme.warning} bold>
              {allAnswered ? '✓ Ready to submit' : '⚠ Some questions unanswered'}
            </Text>
          </Box>
        </Box>
      ) : (
        <>
          {/* Question text */}
          <Box marginBottom={1}>
            <Text color={theme.fg} bold>
              {currentQ?.question}
            </Text>
            {isMultiSelect(tabIdx) && (
              <Text color={theme.accent} dimColor>
                {' '}
                (multi-select, space to toggle)
              </Text>
            )}
          </Box>

          {/* Options */}
          {options.map((opt, i) => {
            const isCursor = i === cursor;
            const isSelected = currentAnswer.includes(opt.label);
            const marker = isSelected ? '●' : isCursor ? '▸' : ' ';
            const markerColor = isSelected
              ? theme.success
              : isCursor
                ? theme.primary
                : theme.fgSubtle;
            return (
              <Box key={opt.label} flexDirection="column" marginBottom={0}>
                <Box>
                  <Text color={markerColor} bold={isCursor}>
                    {marker}{' '}
                  </Text>
                  <Text color={isCursor ? theme.fg : theme.fgMuted} bold={isCursor}>
                    {i + 1}. {opt.label}
                  </Text>
                </Box>
                {opt.description && (
                  <Box marginLeft={4}>
                    <Text color={theme.fgSubtle} dimColor>
                      {opt.description}
                    </Text>
                  </Box>
                )}
              </Box>
            );
          })}

          {/* Custom option */}
          {allowCustom && (
            <Box flexDirection="column" marginTop={1}>
              <Box>
                <Text color={onCustom ? theme.primary : theme.fgSubtle} bold={onCustom}>
                  {onCustom ? '▸ ' : '  '}
                  {options.length + 1}. {customInputs[tabIdx] ? `Custom: ${customInputs[tabIdx]}` : 'Type your own answer…'}
                </Text>
              </Box>
              {customEditing && (
                <Box marginLeft={4}>
                  <Text color={theme.fg}>› {customDraft}</Text>
                  <Text color={theme.accent}>▌</Text>
                </Box>
              )}
            </Box>
          )}
        </>
      )}

      <Box marginTop={1}>
        <Text color={theme.fgSubtle}>{glyph.horz.repeat(width - 4)}</Text>
      </Box>

      {/* Footer */}
      <Box>
        <Text color={theme.fgSubtle} dimColor>
          {customEditing
            ? 'type your answer · enter submit · esc cancel'
            : onConfirmTab
              ? 'enter submit · shift+tab back · esc cancel'
              : '↑↓ navigate · space/enter select · 1-9 jump · tab next · esc cancel'}
        </Text>
      </Box>
    </Box>
  );
};

export default QuestionPrompt;
