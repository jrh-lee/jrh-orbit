import { NodeViewContent, NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { useState, useRef, useEffect, useCallback } from 'react';
import mermaid from 'mermaid';

mermaid.initialize({ startOnLoad: false, theme: 'default', securityLevel: 'loose' });

const LANGUAGES = [
  { value: '', label: 'Plain text' },
  { value: 'mermaid', label: 'Mermaid' },
  { value: 'javascript', label: 'JavaScript' },
  { value: 'typescript', label: 'TypeScript' },
  { value: 'python', label: 'Python' },
  { value: 'rust', label: 'Rust' },
  { value: 'c', label: 'C' },
  { value: 'cpp', label: 'C++' },
  { value: 'java', label: 'Java' },
  { value: 'go', label: 'Go' },
  { value: 'bash', label: 'Bash' },
  { value: 'shell', label: 'Shell' },
  { value: 'json', label: 'JSON' },
  { value: 'yaml', label: 'YAML' },
  { value: 'xml', label: 'XML' },
  { value: 'html', label: 'HTML' },
  { value: 'css', label: 'CSS' },
  { value: 'scss', label: 'SCSS' },
  { value: 'sql', label: 'SQL' },
  { value: 'graphql', label: 'GraphQL' },
  { value: 'markdown', label: 'Markdown' },
  { value: 'lua', label: 'Lua' },
  { value: 'ruby', label: 'Ruby' },
  { value: 'php', label: 'PHP' },
  { value: 'swift', label: 'Swift' },
  { value: 'kotlin', label: 'Kotlin' },
  { value: 'r', label: 'R' },
  { value: 'matlab', label: 'MATLAB' },
  { value: 'dockerfile', label: 'Dockerfile' },
  { value: 'ini', label: 'INI / TOML' },
  { value: 'diff', label: 'Diff' },
];

export function CodeBlockView({ node, updateAttributes }: NodeViewProps) {
  const lang = node.attrs.language || '';
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const [mermaidSvg, setMermaidSvg] = useState('');
  const [mermaidErr, setMermaidErr] = useState('');
  const [showSource, setShowSource] = useState(false);
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const copyCode = useCallback(() => {
    navigator.clipboard.writeText(node.textContent).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  }, [node]);

  const renderMermaid = useCallback(async (code: string) => {
    if (!code.trim()) { setMermaidSvg(''); setMermaidErr(''); return; }
    try {
      const id = `mermaid-${Math.random().toString(36).slice(2, 8)}`;
      const { svg } = await mermaid.render(id, code.trim());
      setMermaidSvg(svg);
      setMermaidErr('');
    } catch {
      setMermaidSvg('');
      setMermaidErr('Diagram syntax error');
    }
  }, []);

  useEffect(() => {
    if (lang === 'mermaid' && !showSource) {
      renderMermaid(node.textContent);
    }
  }, [lang, node.textContent, showSource, renderMermaid]);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  useEffect(() => {
    if (open) {
      setFilter('');
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  const selectedLabel = LANGUAGES.find((l) => l.value === lang)?.label || lang || 'Plain text';
  const filtered = LANGUAGES.filter((l) =>
    l.label.toLowerCase().includes(filter.toLowerCase()) ||
    l.value.toLowerCase().includes(filter.toLowerCase())
  );

  return (
    <NodeViewWrapper as="div" className="code-block-wrapper" style={{ whiteSpace: 'normal' }}>
      <div className="code-block-header" contentEditable={false} ref={ref}>
        <button
          className="code-block-lang-btn"
          onClick={() => setOpen(!open)}
          type="button"
        >
          {selectedLabel}
          <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
            <path d="M2 3l2 2 2-2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
        <button
          className="code-block-copy-btn"
          onClick={copyCode}
          type="button"
          title="코드 복사"
        >
          {copied ? '✓ 복사됨' : (
            <svg width="11" height="11" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="4.5" y="4.5" width="8" height="8" rx="1.5" />
              <path d="M9.5 4.5V3a1.5 1.5 0 0 0-1.5-1.5H3A1.5 1.5 0 0 0 1.5 3v5A1.5 1.5 0 0 0 3 9.5h1.5" />
            </svg>
          )}
        </button>
        {open && (
          <div className="code-block-lang-dropdown">
            <input
              ref={inputRef}
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter..."
              className="code-block-lang-filter"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && filtered.length > 0) {
                  updateAttributes({ language: filtered[0].value });
                  setOpen(false);
                }
                if (e.key === 'Escape') setOpen(false);
              }}
            />
            <div className="code-block-lang-list">
              {filtered.map((l) => (
                <button
                  key={l.value}
                  type="button"
                  className={`code-block-lang-option ${lang === l.value ? 'active' : ''}`}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    updateAttributes({ language: l.value });
                    setOpen(false);
                  }}
                >
                  {l.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      {lang === 'mermaid' && !showSource && mermaidSvg ? (
        <div
          className="mermaid-preview"
          contentEditable={false}
          dangerouslySetInnerHTML={{ __html: mermaidSvg }}
          onDoubleClick={() => setShowSource(true)}
        />
      ) : lang === 'mermaid' && !showSource && mermaidErr ? (
        <div className="mermaid-error" contentEditable={false} onDoubleClick={() => setShowSource(true)}>
          {mermaidErr}
        </div>
      ) : (
        <pre className="code-block-pre">
          <NodeViewContent as={"code" as any} className="code-block-code" />
        </pre>
      )}
      {lang === 'mermaid' && showSource && (
        <button
          className="mermaid-toggle"
          contentEditable={false}
          onClick={() => setShowSource(false)}
          type="button"
        >
          Preview
        </button>
      )}
    </NodeViewWrapper>
  );
}
