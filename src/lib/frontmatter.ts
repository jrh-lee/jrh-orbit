// BOM/CRLF가 섞여도 frontmatter를 인식한다 — 엄격 매칭이 실패하면
// frontmatter 전체가 본문으로 렌더되는 사고가 난다 (2026-07-10 quick memo 사례)
const FM_REGEX = /^﻿?---\r?\n([\s\S]*?)\r?\n---\r?\n*/;

export function splitFrontmatter(raw: string): { frontmatter: string; body: string } {
  const match = raw.match(FM_REGEX);
  if (!match) return { frontmatter: '', body: raw };
  return {
    frontmatter: match[0],
    body: raw.slice(match[0].length),
  };
}

export function joinFrontmatter(frontmatter: string, body: string): string {
  if (!frontmatter) return body;
  return frontmatter + body;
}

function parseYamlValue(raw: string): any {
  const trimmed = raw.trim();
  if (trimmed === '' || trimmed === '""' || trimmed === "''") return '';
  if (trimmed === 'null' || trimmed === '~') return null;
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;

  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1);
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1);
  }

  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    const inner = trimmed.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(',').map(s => {
      const t = s.trim();
      if (t.startsWith('"') && t.endsWith('"')) return t.slice(1, -1);
      if (t.startsWith("'") && t.endsWith("'")) return t.slice(1, -1);
      return t;
    });
  }

  const num = Number(trimmed);
  if (!isNaN(num) && trimmed !== '') return num;

  return trimmed;
}

export function parseFrontmatterFields(fm: string): Record<string, any> {
  const match = fm.match(/^﻿?---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};

  const fields: Record<string, any> = {};
  const lines = match[1].split('\n');

  let currentKey = '';
  let collectingArray = false;
  let arrayItems: any[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (collectingArray) {
      const itemMatch = line.match(/^\s+-\s+(.*)/);
      if (itemMatch) {
        arrayItems.push(parseYamlValue(itemMatch[1]));
        continue;
      } else {
        fields[currentKey] = arrayItems;
        collectingArray = false;
        arrayItems = [];
      }
    }

    const kv = line.match(/^([a-zA-Z_][\w_]*):\s*(.*)?$/);
    if (!kv) continue;
    const [, key, rawValue = ''] = kv;
    currentKey = key;

    if (rawValue.trim() === '' && i + 1 < lines.length && lines[i + 1].match(/^\s+-\s/)) {
      collectingArray = true;
      arrayItems = [];
      continue;
    }

    fields[key] = parseYamlValue(rawValue);
  }

  if (collectingArray) {
    fields[currentKey] = arrayItems;
  }

  return fields;
}

export function updateFrontmatterField(fm: string, key: string, value: string): string {
  const regex = new RegExp(`(^${key}:\\s*)(.*)$`, 'm');
  if (regex.test(fm)) {
    return fm.replace(regex, `$1${value}`);
  }
  return fm.replace(/\r?\n---\r?\n*$/, `\n${key}: ${value}\n---\n`);
}

export function formatFrontmatterValue(value: any): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return String(value);
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const hasObjects = value.some(v => typeof v === 'object' && v !== null);
    if (hasObjects) return JSON.stringify(value);
    return '[' + value.map(v => `"${v}"`).join(', ') + ']';
  }
  if (typeof value === 'string') {
    if (value === '') return '""';
    if (value.includes('"') || value.includes(':') || value.includes('#')) {
      return `"${value.replace(/"/g, '\\"')}"`;
    }
    return `"${value}"`;
  }
  return String(value);
}

export function buildFrontmatter(fields: Record<string, any>): string {
  const lines = ['---'];
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    lines.push(`${key}: ${formatFrontmatterValue(value)}`);
  }
  lines.push('---\n');
  return lines.join('\n');
}
