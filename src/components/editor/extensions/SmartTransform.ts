import { Extension, InputRule, textInputRule } from '@tiptap/core';

/**
 * SmartTransform - TipTap extension for auto-converting text patterns.
 *
 * Greek letters:  alpha -> α, beta -> β, delta -> δ, theta -> θ,
 *                 mu -> μ, pi -> π, sigma -> σ, omega -> ω
 * Math symbols:   deg -> °, sqrt -> √, +/- -> ±
 * Date shorthand: M/D + space -> YYYY-MM-DD (current year)
 */

// Greek letter mappings (word + space triggers replacement)
const greekLetters: Record<string, string> = {
  alpha: 'α',
  beta: 'β',
  delta: 'δ',
  theta: 'θ',
  mu: 'μ',
  pi: 'π',
  sigma: 'σ',
  omega: 'ω',
};

// Math/symbol mappings (word + space triggers replacement)
const mathSymbols: Record<string, string> = {
  deg: '°',
  sqrt: '√',
};

function buildSymbolRules(): InputRule[] {
  const rules: InputRule[] = [];

  // Greek letters: match the word preceded by start-of-line or whitespace, followed by a space
  for (const [word, symbol] of Object.entries(greekLetters)) {
    rules.push(
      textInputRule({
        find: new RegExp(`(?:^|\\s)${word}\\s$`),
        replace: `${symbol} `,
      }),
    );
  }

  // Math symbols: same pattern
  for (const [word, symbol] of Object.entries(mathSymbols)) {
    rules.push(
      textInputRule({
        find: new RegExp(`(?:^|\\s)${word}\\s$`),
        replace: `${symbol} `,
      }),
    );
  }

  // "+/-" does not need trailing space - replace inline
  rules.push(
    textInputRule({
      find: /\+\/-$/,
      replace: '±',
    }),
  );

  return rules;
}

/**
 * Arrow shorthands.
 * Immediate (fire on the closing char): `->` →, `=>` ⇒, `<->` ↔, `<=>` ⇔.
 * Lookbehinds keep `->`/`=>` from firing inside `<->`/`<=>`.
 * Space-triggered (to avoid eating `<->`/`<=>` mid-typing and comparison
 * operators): `<- ` ←, `<= ` ⇐. Word-style: `/up ` ↑, `/down ` ↓.
 */
function buildArrowRules(): InputRule[] {
  const rules: InputRule[] = [
    textInputRule({ find: /<->$/, replace: '↔' }),
    textInputRule({ find: /<=>$/, replace: '⇔' }),
    textInputRule({ find: /(?<!<)->$/, replace: '→' }),
    textInputRule({ find: /(?<![<=])=>$/, replace: '⇒' }),
    // trigger space is consumed — it's an activation key, not intended text
    textInputRule({ find: /<-\s$/, replace: '←' }),
    textInputRule({ find: /<=\s$/, replace: '⇐' }),
  ];
  const words: Record<string, string> = { up: '↑', down: '↓', left: '←', right: '→' };
  for (const [word, symbol] of Object.entries(words)) {
    rules.push(
      new InputRule({
        find: new RegExp(`(^|\\s)/${word}\\s$`),
        handler: ({ state, range, match }) => {
          state.tr.insertText(`${match[1]}${symbol}`, range.from, range.to);
        },
      }),
    );
  }
  return rules;
}

/**
 * Build a date input rule that converts M/D + space into YYYY-MM-DD.
 * Matches patterns like "6/10 " and replaces with "2026-06-10 ".
 */
function buildDateRule(): InputRule {
  // Match M/D (1-2 digit month, 1-2 digit day) followed by a space,
  // preceded by start-of-line or whitespace
  const datePattern = /(?:^|\s)(\d{1,2})\/(\d{1,2})\s$/;

  return new InputRule({
    find: datePattern,
    handler: ({ state, range, match }) => {
      const month = parseInt(match[1], 10);
      const day = parseInt(match[2], 10);

      // Validate month/day ranges
      if (month < 1 || month > 12 || day < 1 || day > 31) return null;

      const year = new Date().getFullYear();
      const mm = String(month).padStart(2, '0');
      const dd = String(day).padStart(2, '0');
      const formatted = `${year}-${mm}-${dd} `;

      // Preserve leading whitespace if the match started after a space
      const fullMatch = match[0];
      const leadingSpace = fullMatch.length > `${match[1]}/${match[2]} `.length ? fullMatch[0] : '';
      const replacement = `${leadingSpace}${formatted}`;

      const { tr } = state;
      tr.insertText(replacement, range.from, range.to);
      return null;
    },
  });
}

export const SmartTransform = Extension.create({
  name: 'smartTransform',

  addInputRules() {
    return [...buildSymbolRules(), ...buildArrowRules(), buildDateRule()];
  },
});
