import { useState, useEffect, useCallback } from 'react';
import { useAppStore } from '../../stores/useAppStore';
import { readJsonFile, writeJsonFile } from '../../lib/fileSystem';
import { FILES } from '../../lib/constants';
import type { NoteType } from '../../types/note';

export interface CustomTemplate {
  id: string;
  noteType: NoteType;
  label: string;
  icon: string;
  body: string;
  isDefault?: boolean;
}

interface TemplatesFile {
  templates: CustomTemplate[];
}

const DEFAULT_TEMPLATES: CustomTemplate[] = [
  {
    id: 'quick-memo', noteType: 'quick-memo', label: 'Quick Memo', icon: '💬', isDefault: true,
    body: '\n- \n',
  },
  {
    id: 'analysis-note', noteType: 'analysis-note', label: 'Analysis Note', icon: '📊', isDefault: true,
    body: [
      '',
      '## 목적',
      '- ',
      '- ',
      '', '',
      '## 내용',
      '',
      '<!-- 자유 형식. 조건, 과정, 결과 등 -->',
      '<!-- 필요 시 에디터 툴바 → [+ 블록 삽입] → 조건 테이블 / 결과 테이블 / 파일 참조 -->',
      '',
      '',
      '',
      '## 분석',
      '- ',
      '- ',
      '- ',
      '', '',
      '## 후속 과제',
      '',
      '<!-- ⚡ - [ ] → 자동 TODO (이 노트와 연결) -->',
      '',
      '- [ ] ',
      '',
    ].join('\n'),
  },
  {
    id: 'test-log', noteType: 'test-log', label: 'Test Log', icon: '🔧', isDefault: true,
    body: [
      '',
      '## 목적',
      '- ',
      '- ',
      '', '',
      '## 내용',
      '',
      '<!-- 장비, 절차, 측정 데이터 -->',
      '<!-- 필요 시 에디터 툴바 → 장비 테이블 / 측정 데이터 테이블 삽입 -->',
      '',
      '',
      '',
      '### 🟢 PASS / 🔴 FAIL / 🟡 CONDITIONAL',
      '',
      '',
      '',
      '## 분석',
      '- ',
      '- ',
      '- ',
      '', '',
      '## 후속 조치',
      '',
      '<!-- ⚡ - [ ] → 자동 TODO (이 노트와 연결) -->',
      '',
      '- [ ] ',
      '',
    ].join('\n'),
  },
  {
    id: 'design-note', noteType: 'design-note', label: 'Design Note', icon: '📐', isDefault: true,
    body: [
      '',
      '## 목적',
      '- ',
      '- ',
      '', '',
      '## 내용',
      '',
      '| 대안       | 장점 | 단점 | 비고 |',
      '| ---------- | ---- | ---- | ---- |',
      '| **{선택}** |      |      | ✅   |',
      '| {대안 2}   |      |      |      |',
      '| {대안 3}   |      |      |      |',
      '',
      '',
      '',
      '## 분석',
      '- ',
      '- ',
      '- ',
      '',
    ].join('\n'),
  },
  {
    id: 'study-note', noteType: 'study-note', label: 'Study Note', icon: '📚', isDefault: true,
    body: [
      '',
      '## 목적',
      '- ',
      '- ',
      '', '',
      '## 내용',
      '',
      '<!-- 출처, 핵심 개념, 수식 등 자유롭게 -->',
      '',
      '',
      '',
      '## 분석',
      '- ',
      '- ',
      '- ',
      '',
    ].join('\n'),
  },
  {
    id: 'blank', noteType: 'blank', label: 'Blank', icon: '📝', isDefault: true,
    body: '\n',
  },
];

export async function loadTemplates(dataDir: string): Promise<CustomTemplate[]> {
  const saved = await readJsonFile<TemplatesFile>(dataDir, FILES.templates);
  if (saved?.templates?.length) return saved.templates;
  return DEFAULT_TEMPLATES;
}

export function buildTypeIconMap(templates: CustomTemplate[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const t of templates) {
    map[t.noteType] = t.icon;
  }
  return map;
}

export function buildTypeAbbrevMap(templates: CustomTemplate[]): Record<string, string> {
  const builtinAbbrev: Record<string, string> = {
    'daily-log': 'daily', 'quick-memo': 'memo', 'analysis-note': 'analysis',
    'test-log': 'test', 'design-note': 'design', 'study-note': 'study',
    'review': 'review', 'blank': 'note',
  };
  const map: Record<string, string> = { ...builtinAbbrev };
  for (const t of templates) {
    if (!map[t.noteType]) {
      map[t.noteType] = t.noteType.replace(/[- ]/g, '').slice(0, 8).toLowerCase() || 'note';
    }
  }
  return map;
}

async function saveTemplates(dataDir: string, templates: CustomTemplate[]) {
  await writeJsonFile(dataDir, FILES.templates, { templates });
}

interface Props {
  onClose: () => void;
  onTemplatesChanged: () => void;
}

export function TemplateEditor({ onClose, onTemplatesChanged }: Props) {
  const { dataDir } = useAppStore();
  const [templates, setTemplates] = useState<CustomTemplate[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editBody, setEditBody] = useState('');
  const [editLabel, setEditLabel] = useState('');
  const [editType, setEditType] = useState('');
  const [editIcon, setEditIcon] = useState('');
  const [typeDropdownOpen, setTypeDropdownOpen] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!dataDir) return;
    loadTemplates(dataDir).then(t => {
      setTemplates(t);
      if (t.length > 0) {
        setSelectedId(t[0].id);
        setEditBody(t[0].body);
        setEditLabel(t[0].label);
        setEditType(t[0].noteType);
        setEditIcon(t[0].icon);
      }
    });
  }, [dataDir]);

  const selected = templates.find(t => t.id === selectedId);

  const handleSelect = useCallback((id: string) => {
    let source = templates;
    if (dirty && selected) {
      const updated = templates.map(t => t.id === selected.id ? { ...t, body: editBody, label: editLabel, noteType: editType as NoteType, icon: editIcon } : t);
      setTemplates(updated);
      source = updated;
    }
    const t = source.find(t => t.id === id);
    if (t) {
      setSelectedId(id);
      setEditBody(t.body);
      setEditLabel(t.label);
      setEditType(t.noteType);
      setEditIcon(t.icon);
      setDirty(false);
    }
  }, [dirty, selected, templates, editBody, editLabel, editType, editIcon]);

  const handleSave = useCallback(async () => {
    if (!dataDir || !selected) return;
    const typeVal = editType.trim().toLowerCase().replace(/\s+/g, '-') || 'blank';
    const updated = templates.map(t => t.id === selected.id ? { ...t, body: editBody, label: editLabel, noteType: typeVal as NoteType, icon: editIcon } : t);
    setTemplates(updated);
    setEditType(typeVal);
    await saveTemplates(dataDir, updated);
    setDirty(false);
    onTemplatesChanged();
  }, [dataDir, selected, templates, editBody, editLabel, editType, editIcon, onTemplatesChanged]);

  const handleAdd = useCallback(async () => {
    if (!dataDir) return;
    const id = `custom-${Date.now()}`;
    const typeId = `custom-${id.slice(7)}`;
    const newTemplate: CustomTemplate = {
      id,
      noteType: typeId as NoteType,
      label: 'New Template',
      icon: '📝',
      body: '\n## Section 1\n<!-- 이 섹션에 대한 가이드 텍스트 -->\n\n## Section 2\n<!-- 섹션이 비어 있을 때 표시되는 안내문 -->\n\n',
    };
    const updated = [...templates, newTemplate];
    setTemplates(updated);
    setSelectedId(id);
    setEditBody(newTemplate.body);
    setEditLabel(newTemplate.label);
    setEditType(newTemplate.noteType);
    setEditIcon(newTemplate.icon);
    setDirty(true);
  }, [dataDir, templates]);

  const handleDelete = useCallback(async () => {
    if (!dataDir || !selected) return;
    const updated = templates.filter(t => t.id !== selected.id);
    setTemplates(updated);
    await saveTemplates(dataDir, updated);
    if (updated.length > 0) {
      setSelectedId(updated[0].id);
      setEditBody(updated[0].body);
      setEditLabel(updated[0].label);
      setEditType(updated[0].noteType);
      setEditIcon(updated[0].icon);
    } else {
      setSelectedId(null);
      setEditBody('');
      setEditLabel('');
      setEditType('');
      setEditIcon('');
    }
    setDirty(false);
    onTemplatesChanged();
  }, [dataDir, selected, templates, onTemplatesChanged]);

  const handleReset = useCallback(async () => {
    if (!dataDir || !selected?.isDefault) return;
    const def = DEFAULT_TEMPLATES.find(d => d.id === selected.id);
    if (!def) return;
    setEditBody(def.body);
    setEditLabel(def.label);
    setEditType(def.noteType);
    setEditIcon(def.icon);
    setDirty(true);
  }, [dataDir, selected]);

  const handleResetAll = useCallback(async () => {
    if (!dataDir) return;
    setTemplates(DEFAULT_TEMPLATES);
    await saveTemplates(dataDir, DEFAULT_TEMPLATES);
    setSelectedId(DEFAULT_TEMPLATES[0].id);
    setEditBody(DEFAULT_TEMPLATES[0].body);
    setEditLabel(DEFAULT_TEMPLATES[0].label);
    setEditType(DEFAULT_TEMPLATES[0].noteType);
    setEditIcon(DEFAULT_TEMPLATES[0].icon);
    setDirty(false);
    onTemplatesChanged();
  }, [dataDir, onTemplatesChanged]);

  const handleNoteTypeChange = useCallback((type: string) => {
    if (!selected) return;
    const updated = templates.map(t => t.id === selected.id ? { ...t, noteType: type as NoteType } : t);
    setTemplates(updated);
    setDirty(true);
  }, [selected, templates]);

  const handleIconChange = useCallback((icon: string) => {
    if (!selected) return;
    setEditIcon(icon);
    setDirty(true);
  }, [selected]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onClose}>
      <div className="bg-paper border border-border rounded-xl shadow-2xl w-[900px] h-[600px] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
          <span className="text-sm font-semibold text-ink">Template Editor</span>
          <div className="flex items-center gap-2">
            <button onClick={handleResetAll} className="px-2 py-1 text-[10px] text-ink-3 hover:text-ink rounded hover:bg-paper-soft transition-colors">
              Reset All to Default
            </button>
            <button onClick={onClose} className="p-1 text-ink-3 hover:text-ink transition-colors">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M4 4l6 6M10 4l-6 6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </div>

        <div className="flex flex-1 min-h-0">
          {/* Template list */}
          <div className="w-48 border-r border-border flex flex-col shrink-0">
            <div className="flex-1 overflow-y-auto">
              {templates.map(t => (
                <button
                  key={t.id}
                  onClick={() => handleSelect(t.id)}
                  className={`w-full text-left px-3 py-2 text-xs border-b border-border/30 transition-colors ${
                    selectedId === t.id ? 'bg-chrome/20 text-ink' : 'text-ink-2 hover:bg-paper-soft'
                  }`}
                >
                  <span className="mr-1">{t.id === selectedId ? editIcon : t.icon}</span>
                  {t.id === selectedId ? editLabel : t.label}
                  {t.isDefault && <span className="ml-1 text-[9px] text-ink-3">(built-in)</span>}
                </button>
              ))}
            </div>
            <button
              onClick={handleAdd}
              className="px-3 py-2 text-xs text-chrome hover:bg-paper-soft transition-colors border-t border-border"
            >
              + Add Template
            </button>
          </div>

          {/* Editor */}
          {selected ? (
            <div className="flex-1 flex flex-col min-w-0">
              <div className="px-4 py-2.5 border-b border-border flex items-center gap-3">
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-ink-3 uppercase tracking-wider">Icon</span>
                  <input
                    value={editIcon}
                    onChange={e => { handleIconChange(e.target.value); }}
                    className="text-xs text-center bg-paper-soft/40 rounded px-1 py-1 border border-transparent outline-none focus:border-border w-8"
                    maxLength={2}
                  />
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-ink-3 uppercase tracking-wider">Name</span>
                  <input
                    value={editLabel}
                    onChange={e => { setEditLabel(e.target.value); setDirty(true); }}
                    className="text-xs text-ink bg-paper-soft/40 rounded px-2 py-1 border border-transparent outline-none focus:border-border w-32"
                  />
                </div>
                <div className="flex items-center gap-1.5 relative">
                  <span className="text-[10px] text-ink-3 uppercase tracking-wider">Type</span>
                  <input
                    value={editType}
                    onChange={e => { setEditType(e.target.value); setDirty(true); setTypeDropdownOpen(true); }}
                    onFocus={() => setTypeDropdownOpen(true)}
                    onBlur={() => setTimeout(() => setTypeDropdownOpen(false), 150)}
                    placeholder="e.g. analysis-note"
                    className="text-xs text-ink bg-paper-soft/40 rounded px-2 py-1 border border-transparent outline-none focus:border-border w-36 placeholder:text-ink-3"
                  />
                  {typeDropdownOpen && (() => {
                    const builtinTypes = ['quick-memo', 'analysis-note', 'test-log', 'design-note', 'study-note', 'blank'];
                    const customTypes = [...new Set(templates.map(t => t.noteType))].filter(t => !builtinTypes.includes(t));
                    const allTypes = [...builtinTypes, ...customTypes];
                    const q = editType.toLowerCase();
                    const filtered = allTypes.filter(t => !q || t.includes(q));
                    if (filtered.length === 0) return null;
                    return (
                      <div className="absolute top-full left-0 mt-1 z-50 bg-paper border border-border rounded-lg shadow-lg py-1 min-w-[160px] max-h-40 overflow-y-auto">
                        {filtered.map(t => (
                          <button
                            key={t}
                            onMouseDown={e => {
                              e.preventDefault();
                              setEditType(t);
                              handleNoteTypeChange(t);
                              setTypeDropdownOpen(false);
                            }}
                            className={`w-full text-left px-2 py-1 text-xs transition-colors ${
                              editType === t ? 'bg-chrome/15 text-ink font-medium' : 'text-ink-2 hover:bg-paper-soft'
                            }`}
                          >
                            {t}
                            {!builtinTypes.includes(t) && <span className="ml-1 text-[9px] text-ink-3">(custom)</span>}
                          </button>
                        ))}
                      </div>
                    );
                  })()}
                </div>
                <div className="flex-1" />
                {selected.isDefault && (
                  <button onClick={handleReset} className="px-2 py-1 text-[10px] text-ink-3 hover:text-ink rounded hover:bg-paper-soft transition-colors">
                    Reset to Default
                  </button>
                )}
                {!selected.isDefault && (
                  <button onClick={handleDelete} className="px-2 py-1 text-[10px] text-red-400 hover:text-red-500 rounded hover:bg-paper-soft transition-colors">
                    Delete
                  </button>
                )}
              </div>
              <textarea
                value={editBody}
                onChange={e => { setEditBody(e.target.value); setDirty(true); }}
                spellCheck={false}
                className="flex-1 p-4 text-xs text-ink bg-paper font-mono resize-none outline-none leading-relaxed"
                placeholder="Write template markdown here..."
              />
              <div className="px-4 py-2 border-t border-border flex items-center justify-between">
                <span className="text-[10px] text-ink-3">
                  {dirty ? 'Unsaved changes' : 'Saved'}
                </span>
                <button
                  onClick={handleSave}
                  disabled={!dirty}
                  className={`px-3 py-1.5 text-xs rounded-lg font-medium transition-colors ${
                    dirty ? 'bg-chrome/30 text-ink hover:bg-chrome/50' : 'bg-paper-muted text-ink-3 cursor-not-allowed'
                  }`}
                >
                  Save
                </button>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center text-ink-3 text-sm">
              Select a template or add a new one.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
