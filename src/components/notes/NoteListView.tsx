import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { join } from '@tauri-apps/api/path';
import { save } from '@tauri-apps/plugin-dialog';
import { useAppStore } from '../../stores/useAppStore';
import { useProjectStore } from '../../stores/useProjectStore';
import { NoteEditor } from '../editor/NoteEditor';
import { BacklinkPanel } from './BacklinkPanel';
import { ResizeHandle } from '../ui/ResizeHandle';
import { splitFrontmatter, joinFrontmatter, parseFrontmatterFields, updateFrontmatterField, buildFrontmatter, formatFrontmatterValue } from '../../lib/frontmatter';
import { FOLDERS } from '../../lib/constants';
import { normalizeProject, NOTE_TYPE_ICONS, NOTE_TYPE_ABBREV } from '../../types/note';
import { updateNoteLinks, removeNoteLinks } from '../../lib/linkGraph';
import { insertNoteToDailyLog, updateDailyLogNoteRow, removeNoteFromDailyLog, syncNoteCheckboxesWithTodos } from '../../lib/dailyLogHelper';
import { readJsonFile } from '../../lib/fileSystem';
import { todayKey } from '../../lib/dateUtils';
import { FILES } from '../../lib/constants';
import { writeJsonFile } from '../../lib/fileSystem';
import type { TodosFile } from '../../types/task';
import type { TopicsFile, TopicEntry } from '../../types/dataFiles';
import { useExperimentStore } from '../../stores/useExperimentStore';
import { experimentEmoji } from '../../types/experiment';
import { recordNoteEdit } from '../../lib/activityLog';
import { reindexNote } from '../../lib/searchIndex';
import { indexNote, removeNoteIndex } from '../../lib/db';
import { AutoSuggestionBanner } from './AutoSuggestionBanner';
import { TemplateEditor, loadTemplates, buildTypeIconMap, buildTypeAbbrevMap } from './TemplateEditor';
import type { CustomTemplate } from './TemplateEditor';
import { extractGuideMap } from '../editor/extensions/SectionGuide';
import { useConfigStore } from '../../stores/useConfigStore';
import { Dropdown } from '../ui/Dropdown';
import type { NoteType, NoteStatus } from '../../types/note';
import { tagBg } from '../../lib/colorUtils';

const NOTELIST_MIN = 160;
const NOTELIST_MAX = 400;

interface NoteEntry {
  path: string;
  filename: string;
  id: string;
  title: string;
  noteType: NoteType | string;
  updated: string;
  created: string;
  project: string[];
  topic: string;
  experiment: string;
  subsystem: string[];
  tags: string[];
  status: NoteStatus;
  related: string[];
  /** 노트별 커스텀 이모지 아이콘 (frontmatter icon) — 없으면 타입 아이콘 */
  icon?: string;
}

interface NoteMeta {
  title: string;
  project: string[];
  topic: string;
  experiment: string;
  subsystem: string[];
  tags: string[];
  status: NoteStatus;
}

interface NoteTemplate {
  id: string;
  noteType: NoteType;
  label: string;
  icon: string;
  title: string;
  body: string;
}

const NOTE_TEMPLATES: NoteTemplate[] = [
  {
    id: 'quick-memo', noteType: 'quick-memo', label: 'Quick Memo', icon: '💬',
    title: '', body: '\n- \n',
  },
  {
    id: 'analysis-note', noteType: 'analysis-note', label: 'Analysis Note', icon: '📊',
    title: '', body: [
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
    id: 'test-log', noteType: 'test-log', label: 'Test Log', icon: '🔧',
    title: '', body: [
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
    id: 'design-note', noteType: 'design-note', label: 'Design Note', icon: '📐',
    title: '', body: [
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
    id: 'study-note', noteType: 'study-note', label: 'Study Note', icon: '📚',
    title: '', body: [
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
    id: 'blank', noteType: 'blank', label: 'Blank', icon: '📝',
    title: 'Untitled', body: '\n',
  },
];

function generateNoteId(noteType: string, existingNotes: NoteEntry[], abbrevMap?: Record<string, string>): string {
  const today = todayKey();
  const abbrev = abbrevMap?.[noteType] ?? NOTE_TYPE_ABBREV[noteType as NoteType] ?? (noteType.replace(/[- ]/g, '').slice(0, 8).toLowerCase() || 'note');
  const prefix = `${today}-${abbrev}-`;
  let seq = 1;
  for (const n of existingNotes) {
    if (n.id?.startsWith(prefix)) {
      const num = parseInt(n.id.slice(prefix.length), 10);
      if (!isNaN(num) && num >= seq) seq = num + 1;
    }
  }
  return `${prefix}${String(seq).padStart(3, '0')}`;
}

function makeFrontmatter(noteType: NoteType, title: string, noteId: string): string {
  const iso = new Date().toISOString();
  const today = todayKey();
  return buildFrontmatter({
    id: noteId,
    type: noteType,
    title: title,
    date: today,
    project: [],
    topic: '',
    experiment: '',
    tags: [],
    related: [`${today}-daily`],
    status: 'draft',
    created: iso,
    updated: iso,
  });
}

function formatRelativeTime(iso: string): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' });
}

function extractTitle(raw: string, filename: string): string {
  const match = raw.match(/^---\n[\s\S]*?title:\s*"?([^"\n]+)"?\s*\n[\s\S]*?---/);
  if (match) return match[1];
  const h1 = raw.match(/^#\s+(.+)/m);
  if (h1) return h1[1];
  return filename.replace('.md', '');
}

export function NoteListView() {
  const { dataDir, pendingNotePath, pendingNoteAnchor, clearPendingNote, pendingTagFilter, clearPendingTagFilter, setActiveProject, activeProject } = useAppStore();
  const { projects } = useProjectStore();
  const [notes, setNotes] = useState<NoteEntry[]>([]);
  const [activeNote, setActiveNote] = useState<string | null>(null);
  const [activeNoteId, setActiveNoteId] = useState('');
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [noteLinkCopied, setNoteLinkCopied] = useState(false);
  const [noteIcon, setNoteIcon] = useState('');
  const [iconPickerOpen, setIconPickerOpen] = useState(false);
  const [iconInput, setIconInput] = useState('');
  const selectSeqRef = useRef(0);
  const [meta, setMeta] = useState<NoteMeta>({ title: '', project: [], topic: '', experiment: '', subsystem: [], tags: [], status: 'draft' });
  const [projectDropdownOpen, setProjectDropdownOpen] = useState(false);
  const [tagInput, setTagInput] = useState('');
  const [tagHighlight, setTagHighlight] = useState(0);
  const [renamingNote, setRenamingNote] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; path: string } | null>(null);
  const [listWidth, setListWidth] = useState(240);
  const [conflictNote, setConflictNote] = useState(false);
  const [showTemplateMenu, setShowTemplateMenu] = useState(false);
  const [filterProject, setFilterProject] = useState('');
  const [filterTag, setFilterTag] = useState('');
  const [sortBy, setSortBy] = useState<'updated' | 'title' | 'created'>('updated');
  const [knownTags, setKnownTags] = useState<{ name: string; count: number }[]>([]);
  const [tagDropdownOpen, setTagDropdownOpen] = useState(false);
  const [linksPanelOpen, setLinksPanelOpen] = useState(false);
  const [topics, setTopics] = useState<TopicEntry[]>([]);
  const [topicDropdownOpen, setTopicDropdownOpen] = useState(false);
  const [showNewTopicInput, setShowNewTopicInput] = useState(false);
  const [newTopicName, setNewTopicName] = useState('');
  const experiments = useExperimentStore((s) => s.experiments);
  const [experimentDropdownOpen, setExperimentDropdownOpen] = useState(false);
  const [showNewExperimentInput, setShowNewExperimentInput] = useState(false);
  const [newExperimentName, setNewExperimentName] = useState('');
  const [groupView, setGroupView] = useState(() => localStorage.getItem('orbit-notes-group-view') === '1');
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [listHidden, setListHidden] = useState(() => localStorage.getItem('orbit-notes-list-hidden') === '1');
  const [scrollAnchor, setScrollAnchor] = useState<string | null>(null);
  const [showTemplateEditor, setShowTemplateEditor] = useState(false);
  const [customTemplates, setCustomTemplates] = useState<CustomTemplate[]>([]);
  const fmRef = useRef('');
  const lastWriteTime = useRef(0);
  const prevBodyRef = useRef('');
  /** Set when a note click updates activeProject — the filter-sync effect
   *  must not react to it (selecting a note must never change the list filter) */
  const skipFilterSyncRef = useRef(false);

  const handleListResize = useCallback((delta: number) => {
    setListWidth((w) => Math.min(NOTELIST_MAX, Math.max(NOTELIST_MIN, w + delta)));
  }, []);

  const allTags = useMemo(() => {
    const set = new Set<string>();
    notes.forEach(n => n.tags.forEach(t => set.add(t)));
    return [...set].sort();
  }, [notes]);

  const tagSuggestions = useMemo(() => {
    const q = tagInput.trim().toLowerCase();
    if (!q) return [];
    return knownTags.filter(t => t.name.includes(q) && !meta.tags.includes(t.name)).slice(0, 8);
  }, [tagInput, knownTags, meta.tags]);

  const allProjects = useMemo(() => {
    const set = new Set<string>();
    notes.forEach(n => n.project.forEach(p => set.add(p)));
    return [...set].sort();
  }, [notes]);

  /** Project ids matching the active note's project names */
  const noteProjectIds = useMemo(
    () => meta.project.map(name => projects.find(p => p.name === name)?.id).filter((x): x is string => !!x),
    [meta.project, projects],
  );

  const relevantExperiments = useMemo(() => {
    const order: Record<string, number> = { active: 0, done: 1, archived: 2 };
    const list = noteProjectIds.length
      ? experiments.filter(e => noteProjectIds.includes(e.projectId))
      : experiments;
    return [...list].sort((a, b) => (order[a.status] ?? 0) - (order[b.status] ?? 0) || a.name.localeCompare(b.name));
  }, [experiments, noteProjectIds]);

  async function handleCreateExperiment(name: string) {
    const trimmed = name.trim();
    if (!dataDir || !trimmed) return;
    const projectId = noteProjectIds[0];
    if (!projectId) return;
    const exists = experiments.some(e => e.projectId === projectId && e.name === trimmed);
    if (!exists) {
      await useExperimentStore.getState().add(dataDir, { name: trimmed, projectId, status: 'active' });
    }
    updateMeta('experiment', trimmed);
  }

  const filteredNotes = useMemo(() => {
    let list = notes;
    if (filterProject) list = list.filter(n => n.project.includes(filterProject));
    if (filterTag) list = list.filter(n => n.tags.includes(filterTag));
    return [...list].sort((a, b) => {
      if (sortBy === 'title') return a.title.localeCompare(b.title);
      if (sortBy === 'created') return (b.created || '').localeCompare(a.created || '');
      return (b.updated || b.filename).localeCompare(a.updated || a.filename);
    });
  }, [notes, filterProject, filterTag, sortBy]);

  interface NoteGroup {
    project: string;
    direct: NoteEntry[];
    experiments: { name: string; notes: NoteEntry[] }[];
  }

  const UNASSIGNED = '미지정';

  const groupedNotes = useMemo((): NoteGroup[] | null => {
    if (!groupView) return null;
    const map = new Map<string, { direct: NoteEntry[]; exps: Map<string, NoteEntry[]> }>();
    const seen: string[] = [];
    const ensure = (p: string) => {
      if (!map.has(p)) { map.set(p, { direct: [], exps: new Map() }); seen.push(p); }
      return map.get(p)!;
    };
    for (const n of filteredNotes) {
      const projList = n.project.length ? n.project : [UNASSIGNED];
      for (const p of projList) {
        const g = ensure(p);
        if (n.experiment) {
          if (!g.exps.has(n.experiment)) g.exps.set(n.experiment, []);
          g.exps.get(n.experiment)!.push(n);
        } else {
          g.direct.push(n);
        }
      }
    }
    const projOrder = projects.map(p => p.name);
    seen.sort((a, b) => {
      if (a === UNASSIGNED) return 1;
      if (b === UNASSIGNED) return -1;
      const ia = projOrder.indexOf(a);
      const ib = projOrder.indexOf(b);
      if (ia !== -1 && ib !== -1) return ia - ib;
      if (ia !== -1) return -1;
      if (ib !== -1) return 1;
      return a.localeCompare(b);
    });
    return seen.map(p => {
      const g = map.get(p)!;
      return {
        project: p,
        direct: g.direct,
        experiments: [...g.exps.entries()]
          .map(([name, ns]) => ({ name, notes: ns }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      };
    });
  }, [groupView, filteredNotes, projects]);

  function toggleGroup(key: string) {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleGroupView() {
    setGroupView(v => {
      localStorage.setItem('orbit-notes-group-view', v ? '0' : '1');
      return !v;
    });
  }

  function toggleListHidden() {
    setListHidden(v => {
      localStorage.setItem('orbit-notes-list-hidden', v ? '0' : '1');
      return !v;
    });
  }

  /** Cycle through the filtered list without the list pane (collapsed strip) */
  function navigateNote(dir: 1 | -1) {
    if (filteredNotes.length === 0) return;
    const idx = filteredNotes.findIndex(n => n.path === activeNote);
    const next = idx === -1 ? 0 : (idx + dir + filteredNotes.length) % filteredNotes.length;
    handleSelectNote(filteredNotes[next].path);
  }

  useEffect(() => {
    if (!dataDir) return;
    loadNotes();
    loadTopics();
    loadCustomTemplates();
    useExperimentStore.getState().load(dataDir).catch(() => {});
  }, [dataDir]);

  async function loadKnownTags(noteEntries?: NoteEntry[]) {
    if (!dataDir) return;
    const tagMap = new Map<string, number>();
    const entries = noteEntries ?? notes;
    for (const n of entries) {
      if (Array.isArray(n.tags)) {
        for (const t of n.tags) {
          if (t) tagMap.set(t, (tagMap.get(t) ?? 0) + 1);
        }
      }
    }
    const todosData = await readJsonFile<TodosFile>(dataDir, FILES.todos);
    if (todosData?.todos) {
      for (const task of todosData.todos) {
        task.tags?.forEach(t => { if (t) tagMap.set(t, (tagMap.get(t) ?? 0) + 1); });
        task.subtasks?.forEach(st => st.tags?.forEach(t => { if (t) tagMap.set(t, (tagMap.get(t) ?? 0) + 1); }));
      }
    }
    setKnownTags(
      [...tagMap.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([name, count]) => ({ name, count })),
    );
  }

  async function loadTopics() {
    if (!dataDir) return;
    const data = await readJsonFile<TopicsFile>(dataDir, FILES.topics);
    if (data?.topics) {
      setTopics(data.topics.sort((a, b) => b.last_used.localeCompare(a.last_used)));
    }
  }

  async function updateTopicsFile(name: string, noteProject: string[], noteSubsystem: string[], prevTopic?: string) {
    if (!dataDir) return;
    if (prevTopic === name) return;
    const data = await readJsonFile<TopicsFile>(dataDir, FILES.topics) ?? { topics: [] };

    if (prevTopic) {
      const prev = data.topics.find(t => t.name === prevTopic);
      if (prev && prev.note_count > 0) {
        prev.note_count -= 1;
      }
    }

    if (name) {
      const existing = data.topics.find(t => t.name === name);
      if (existing) {
        existing.note_count += 1;
        existing.last_used = todayKey();
        if (!existing.project && noteProject[0]) {
          existing.project = noteProject[0];
        }
      } else {
        data.topics.push({
          name,
          project: noteProject[0] ?? '',
          subsystem: noteSubsystem[0] ?? '',
          created: todayKey(),
          note_count: 1,
          last_used: todayKey(),
          keywords: [],
        });
      }
    }

    await writeJsonFile(dataDir, FILES.topics, data);
    setTopics(data.topics.sort((a, b) => b.last_used.localeCompare(a.last_used)));
    window.dispatchEvent(new CustomEvent('topics-changed'));
  }

  async function loadCustomTemplates() {
    if (!dataDir) return;
    const t = await loadTemplates(dataDir);
    setCustomTemplates(t);
  }

  const activeTemplates: NoteTemplate[] = useMemo(() => {
    if (customTemplates.length > 0) {
      return customTemplates.map(t => ({ id: t.id, noteType: t.noteType, label: t.label, icon: t.icon, title: '', body: t.body }));
    }
    return NOTE_TEMPLATES;
  }, [customTemplates]);

  const typeIconMap = useMemo(() => {
    if (customTemplates.length > 0) return buildTypeIconMap(customTemplates);
    return {} as Record<string, string>;
  }, [customTemplates]);

  const typeAbbrevMap = useMemo(() => {
    if (customTemplates.length > 0) return buildTypeAbbrevMap(customTemplates);
    return NOTE_TYPE_ABBREV as Record<string, string>;
  }, [customTemplates]);

  const sectionGuidesEnabled = useConfigStore((s) => s.editor.section_guides);

  const activeGuideMap = useMemo(() => {
    if (!sectionGuidesEnabled) return undefined;
    const noteType = notes.find(n => n.path === activeNote)?.noteType;
    if (!noteType) return undefined;
    const merged: Record<string, string> = {};
    for (const t of activeTemplates) {
      if (t.noteType === noteType && t.body) {
        Object.assign(merged, extractGuideMap(t.body));
      }
    }
    return Object.keys(merged).length > 0 ? merged : undefined;
  }, [sectionGuidesEnabled, activeNote, notes, activeTemplates]);

  useEffect(() => {
    if (!pendingNotePath || notes.length === 0) return;
    handleSelectNote(pendingNotePath);
    if (pendingNoteAnchor) setScrollAnchor(pendingNoteAnchor);
    clearPendingNote();
  }, [pendingNotePath, notes]);

  // 탭을 갔다 와도 마지막에 보던 노트를 다시 연다 — 매번 빈 화면에서
  // 다시 클릭하는 불편 제거. 명시적 열기(pendingNotePath)가 항상 우선.
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current || notes.length === 0) return;
    restoredRef.current = true;
    if (pendingNotePath || activeNote) return;
    const saved = localStorage.getItem('orbit-last-open-note');
    if (saved && notes.some(n => n.path === saved)) {
      handleSelectNote(saved);
    }
  }, [notes, pendingNotePath]);

  useEffect(() => {
    if (!pendingTagFilter) return;
    setFilterTag(pendingTagFilter);
    clearPendingTagFilter();
  }, [pendingTagFilter]);

  useEffect(() => {
    if (skipFilterSyncRef.current) {
      skipFilterSyncRef.current = false;
      return;
    }
    const proj = activeProject ? projects.find(p => p.id === activeProject)?.name ?? '' : '';
    setFilterProject(proj);
  }, [activeProject, projects]);

  useEffect(() => {
    function handleClick() { setContextMenu(null); setTagDropdownOpen(false); setTopicDropdownOpen(false); setExperimentDropdownOpen(false); setShowTemplateMenu(false); }
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, []);

  useEffect(() => {
    const handler = () => loadKnownTags();
    window.addEventListener('tasks-changed', handler);
    return () => {
      window.removeEventListener('tasks-changed', handler);
    };
  }, [dataDir]);

  useEffect(() => {
    const handler = () => {
      if (activeNote && Date.now() - lastWriteTime.current > 2000) {
        setConflictNote(true);
      }
      loadNotes();
    };
    window.addEventListener('notes-changed', handler);
    return () => window.removeEventListener('notes-changed', handler);
  }, [dataDir, activeNote]);

  // 동기화 블록(미러)에서 원본을 역기입한 경우 — 그 원본이 지금 열려 있으면
  // 즉시 다시 읽는다. 열린 에디터가 옛 내용으로 자동저장하면 역기입이 덮인다.
  useEffect(() => {
    const handler = (e: Event) => {
      const path = (e as CustomEvent<{ path: string }>).detail?.path;
      if (path && path === activeNote) handleSelectNote(activeNote);
    };
    window.addEventListener('note-external-edit', handler);
    return () => window.removeEventListener('note-external-edit', handler);
  });

  async function loadNotes() {
    if (!dataDir) return;
    try {
      const dir = await join(dataDir, FOLDERS.research);
      const files = await invoke<string[]>('list_notes', { dir });

      const entries: NoteEntry[] = await Promise.all(
        files.map(async (f) => {
          const filename = f.split(/[/\\]/).pop() ?? f;
          let title = filename.replace('.md', '');
          let id = '';
          let noteType: string = 'analysis-note';
          let updated = '';
          let created = '';
          let project: string[] = [];
          let topic = '';
          let experiment = '';
          let subsystem: string[] = [];
          let tags: string[] = [];
          let status: NoteStatus = 'draft';
          let related: string[] = [];
          let icon = '';
          try {
            const raw = await invoke<string>('read_note', { path: f });
            const fields = parseFrontmatterFields(splitFrontmatter(raw).frontmatter);
            title = fields.title || extractTitle(raw, filename);
            id = fields.id ?? '';
            noteType = fields.type ?? 'analysis-note';
            updated = fields.updated ?? '';
            created = fields.created ?? '';
            project = normalizeProject(fields.project);
            topic = fields.topic ?? '';
            experiment = fields.experiment ?? '';
            subsystem = Array.isArray(fields.subsystem) ? fields.subsystem : [];
            tags = Array.isArray(fields.tags) ? fields.tags : [];
            status = fields.status ?? 'draft';
            related = Array.isArray(fields.related) ? fields.related : (fields.related ? [fields.related] : []);
            icon = fields.icon ?? '';
          } catch {}
          return { path: f, filename, id, noteType, title, updated, created, project, topic, experiment, subsystem, tags, status, related, icon };
        }),
      );

      entries.sort((a, b) => (b.updated || b.filename).localeCompare(a.updated || a.filename));
      setNotes(entries);
      loadKnownTags(entries);
    } catch {
      setNotes([]);
    }
  }

  async function handleSelectNote(fullPath: string) {
    setConflictNote(false);
    localStorage.setItem('orbit-last-open-note', fullPath);
    // 빠르게 연속 클릭하면 느린 읽기(대용량 노트)가 나중에 도착해 상태를
    // 다른 노트의 내용으로 덮을 수 있다 — 마지막 선택만 반영 (노트 섞임 사고 방지)
    const seq = ++selectSeqRef.current;
    try {
      const raw = await invoke<string>('read_note', { path: fullPath });
      if (seq !== selectSeqRef.current) return;
      const { frontmatter, body: b } = splitFrontmatter(raw);
      fmRef.current = frontmatter;
      prevBodyRef.current = b;
      setBody(b);
      setActiveNote(fullPath);

      const fields = parseFrontmatterFields(frontmatter);
      const noteProject = normalizeProject(fields.project);
      setActiveNoteId(fields.id ?? '');
      setNoteIcon(fields.icon ?? '');
      setIconPickerOpen(false);
      setMeta({
        title: fields.title ?? 'Untitled',
        project: noteProject,
        topic: fields.topic ?? '',
        experiment: fields.experiment ?? '',
        subsystem: Array.isArray(fields.subsystem) ? fields.subsystem : [],
        tags: fields.tags ?? [],
        status: fields.status ?? 'draft',
      });
      setTagInput('');
      if (noteProject.length > 0) {
        const proj = projects.find(p => p.name === noteProject[0]);
        if (proj && proj.id !== activeProject) {
          skipFilterSyncRef.current = true;
          setActiveProject(proj.id);
        }
      }
    } catch {
      // 읽기 실패 시 절대 빈 본문을 올리지 않는다 — activeNote는 이전 노트인 채로
      // body=''가 되면 다음 자동저장이 이전 노트를 빈 내용으로 덮어쓴다 (실제 사고 사례)
      setError('노트를 읽지 못했습니다 (드라이브 일시 잠금일 수 있음) — 다시 클릭해 주세요');
    }
  }

  function updateMeta(field: keyof NoteMeta, value: string | string[]) {
    const updated = { ...meta, [field]: value };
    setMeta(updated);

    let fm = fmRef.current;
    if (field === 'title') {
      fm = updateFrontmatterField(fm, 'title', formatFrontmatterValue(value));
    } else if (field === 'project') {
      fm = updateFrontmatterField(fm, 'project', formatFrontmatterValue(value));
    } else if (field === 'tags') {
      fm = updateFrontmatterField(fm, 'tags', formatFrontmatterValue(value));
    } else if (field === 'subsystem') {
      fm = updateFrontmatterField(fm, 'subsystem', formatFrontmatterValue(value));
    } else if (field === 'topic') {
      fm = updateFrontmatterField(fm, 'topic', formatFrontmatterValue(value));
    } else if (field === 'experiment') {
      fm = updateFrontmatterField(fm, 'experiment', formatFrontmatterValue(value));
    } else if (field === 'status') {
      fm = updateFrontmatterField(fm, 'status', value as string);
    }
    fm = updateFrontmatterField(fm, 'updated', new Date().toISOString());
    fmRef.current = fm;

    if (activeNote) {
      if (!writeGuardOk(activeNote)) return;
      lastWriteTime.current = Date.now();
      invoke('write_note', { path: activeNote, content: joinFrontmatter(fm, body) }).catch(() => {});

      const noteEntry = notes.find(n => n.path === activeNote);
      indexNote(
        activeNote,
        activeNoteId,
        updated.title,
        noteEntry?.noteType ?? 'analysis-note',
        updated.project,
        updated.subsystem,
        updated.topic,
        updated.tags,
        updated.status,
        body,
        noteEntry?.created ?? '',
        new Date().toISOString(),
        updated.experiment,
      ).catch((e) => console.error('[indexNote] updateMeta failed:', e));
    }

    if (field === 'title') {
      setNotes(prev => prev.map(n =>
        n.path === activeNote ? { ...n, title: value as string } : n
      ));
    }
    if (field === 'project' || field === 'topic' || field === 'experiment') {
      setNotes(prev => prev.map(n =>
        n.path === activeNote ? { ...n, [field]: value } : n
      ));
    }
    if (field === 'tags') {
      window.dispatchEvent(new CustomEvent('tags-changed'));
    }

    if (dataDir && activeNoteId && (field === 'title' || field === 'project' || field === 'topic')) {
      const noteType = notes.find(n => n.path === activeNote)?.noteType ?? 'analysis-note';
      const t = field === 'title' ? (value as string) : updated.title;
      const p = field === 'project' ? (value as string[]).join(', ') : updated.project.join(', ');
      const tp = field === 'topic' ? (value as string) : updated.topic;
      updateDailyLogNoteRow(dataDir, activeNoteId, t, noteType, p, tp).catch(() => {});
    }
  }

  function handleAddTag(value?: string) {
    const raw = (value ?? tagInput).trim();
    if (!raw) return;
    const normalized = raw.toLowerCase().replace(/[_\s]+/g, '-').replace(/[^a-z0-9가-힣ㄱ-ㅎㅏ-ㅣ\-]/g, '').replace(/-{2,}/g, '-').replace(/^-|-$/g, '');
    if (!normalized || meta.tags.includes(normalized)) { setTagInput(''); return; }
    updateMeta('tags', [...meta.tags, normalized]);
    setTagInput('');
    setTagDropdownOpen(false);
  }

  function handleRemoveTag(tag: string) {
    updateMeta('tags', meta.tags.filter(t => t !== tag));
  }

  /** 최후의 안전망: 저장하려는 내용의 id가 대상 파일명과 다르면 차단.
   *  (연구노트는 파일명 = id) 레이스로 다른 노트의 상태가 남아 있어도
   *  교차 오염이 파일에 닿기 전에 막는다. */
  function writeGuardOk(targetPath: string): boolean {
    const stem = (targetPath.split(/[\\/]/).pop() ?? '').replace(/\.md$/, '');
    const fmId = parseFrontmatterFields(fmRef.current).id;
    if (fmId && stem && fmId !== stem) {
      console.error(`[write-guard] 내용 id "${fmId}" ≠ 파일 "${stem}" — 저장 차단`);
      setError(`저장 차단: 노트 상태 불일치 감지 (${fmId} → ${stem}) — 노트를 다시 열어주세요`);
      return false;
    }
    return true;
  }

  /** 노트별 이모지 아이콘 설정/해제 — frontmatter icon 필드 */
  function updateNoteIcon(emoji: string) {
    if (!activeNote || !writeGuardOk(activeNote)) return;
    const v = emoji.trim();
    setNoteIcon(v);
    setIconPickerOpen(false);
    setIconInput('');
    fmRef.current = updateFrontmatterField(fmRef.current, 'icon', v);
    lastWriteTime.current = Date.now();
    invoke('write_note', { path: activeNote, content: joinFrontmatter(fmRef.current, body) }).catch(() => {});
    setNotes(prev => prev.map(n => (n.path === activeNote ? { ...n, icon: v } : n)));
  }

  const handleChange = useCallback(
    (md: string) => {
      setBody(md);
      if (activeNote) {
        if (!writeGuardOk(activeNote)) return;
        lastWriteTime.current = Date.now();
        const fields = parseFrontmatterFields(fmRef.current);
        if (fields.status === 'draft' && md.trim().length > 0) {
          fmRef.current = updateFrontmatterField(fmRef.current, 'status', 'in-progress');
          setMeta(prev => ({ ...prev, status: 'in-progress' }));
        }
        fmRef.current = updateFrontmatterField(fmRef.current, 'updated', new Date().toISOString());
        // 안전망: 내용이 통째로 비워지는 저장은 이전 본문을 rescue 백업으로 남긴다
        // (읽기 실패로 빈 에디터가 뜬 뒤 자동저장이 원본을 덮어쓰는 사고 대비)
        if (dataDir && md.trim() === '' && prevBodyRef.current.trim().length > 50) {
          const fname = (activeNote.split(/[\\/]/).pop() ?? 'note.md').replace(/\.md$/, '');
          invoke('write_note', {
            path: `${dataDir}/backups/rescue/${fname}-${Date.now()}.md`,
            content: joinFrontmatter(fmRef.current, prevBodyRef.current),
          }).catch(() => {});
        }
        invoke('write_note', { path: activeNote, content: joinFrontmatter(fmRef.current, md) })
          .then(() => window.dispatchEvent(new CustomEvent('note-saved')))
          .catch(() => {});
        if (dataDir && activeNoteId) recordNoteEdit(dataDir, activeNoteId);

        if (dataDir && activeNoteId) {
          const noteType = fields.type ?? 'analysis-note';
          const proj = normalizeProject(fields.project);
          syncNoteCheckboxesWithTodos(
            dataDir, activeNoteId, noteType, prevBodyRef.current, md,
            proj[0] ?? 'GENERAL', Array.isArray(fields.subsystem) ? fields.subsystem[0] : undefined,
          ).then(updated => {
            if (updated) {
              prevBodyRef.current = updated;
              setBody(updated);
              invoke('write_note', { path: activeNote, content: joinFrontmatter(fmRef.current, updated) })
                .then(() => window.dispatchEvent(new CustomEvent('note-saved')))
                .catch(() => {});
              window.dispatchEvent(new CustomEvent('tasks-changed'));
            } else {
              prevBodyRef.current = md;
            }
          }).catch(() => { prevBodyRef.current = md; });
        } else {
          prevBodyRef.current = md;
        }
      }
    },
    [activeNote, dataDir, activeNoteId],
  );

  async function handleCreate(template: NoteTemplate = activeTemplates[0]) {
    if (!dataDir) return;
    setError(null);
    setShowTemplateMenu(false);

    try {
      const noteId = generateNoteId(template.noteType, notes, typeAbbrevMap);
      const filename = `${noteId}.md`;
      const fullPath = await join(dataDir, FOLDERS.research, filename);

      await invoke('ensure_dir', { path: await join(dataDir, FOLDERS.research) });

      const title = template.title || noteId;
      const today = todayKey();
      const fm = makeFrontmatter(template.noteType, title, noteId);
      await invoke('write_note', { path: fullPath, content: fm + template.body });
      reindexNote(fullPath, template.noteType).catch(() => {});
      window.dispatchEvent(new CustomEvent('notes-changed'));

      updateNoteLinks(dataDir, noteId, [`${today}-daily`]).catch(() => {});
      insertNoteToDailyLog(dataDir, noteId, title, template.noteType, '').catch(() => {});
      await loadNotes();

      fmRef.current = fm;
      setBody(template.body);
      setActiveNote(fullPath);
      setActiveNoteId(noteId);
      setMeta({ title, project: [], topic: '', experiment: '', subsystem: [], tags: [], status: 'draft' });
      setTagInput('');
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleDelete(path: string) {
    try {
      const deletedNote = notes.find(n => n.path === path);
      await invoke('delete_note', { path });
      removeNoteIndex(path).catch(() => {});
      if (deletedNote?.id) {
        removeNoteLinks(dataDir, deletedNote.id).catch(() => {});
        removeNoteFromDailyLog(dataDir, deletedNote.id).catch(() => {});
      }
      window.dispatchEvent(new CustomEvent('notes-changed'));
      if (localStorage.getItem('orbit-last-open-note') === path) {
        localStorage.removeItem('orbit-last-open-note');
      }
      if (activeNote === path) {
        setActiveNote(null);
        setActiveNoteId('');
        setBody('');
        setMeta({ title: '', project: [], topic: '', experiment: '', subsystem: [], tags: [], status: 'draft' });
      }
      await loadNotes();
    } catch (e) {
      setError(String(e));
    }
  }

  async function handlePromote(sourcePath: string, targetType: NoteType) {
    if (!dataDir) return;
    const sourceNote = notes.find(n => n.path === sourcePath);
    if (!sourceNote) return;

    try {
      const raw = await invoke<string>('read_note', { path: sourcePath });
      const { body: sourceBody } = splitFrontmatter(raw);

      const noteId = generateNoteId(targetType, notes, typeAbbrevMap);
      const filename = `${noteId}.md`;
      const fullPath = await join(dataDir, FOLDERS.research, filename);

      const template = activeTemplates.find(t => t.noteType === targetType);
      const title = sourceNote.title || noteId;
      const today = todayKey();
      const iso = new Date().toISOString();

      const fm = buildFrontmatter({
        id: noteId,
        type: targetType,
        title,
        date: today,
        project: sourceNote.project,
        topic: sourceNote.topic,
        subsystem: sourceNote.subsystem,
        tags: sourceNote.tags,
        related: [sourceNote.id, `${today}-daily`].filter(Boolean),
        status: 'draft',
        created: iso,
        updated: iso,
      });

      const newBody = sourceBody || template?.body || '\n';
      await invoke('write_note', { path: fullPath, content: fm + newBody });

      await invoke('delete_note', { path: sourcePath });

      updateNoteLinks(dataDir, noteId, [sourceNote.id, `${today}-daily`].filter(Boolean)).catch(() => {});
      insertNoteToDailyLog(dataDir, noteId, title, targetType, sourceNote.project.join(', '), sourceNote.topic).catch(() => {});
      window.dispatchEvent(new CustomEvent('notes-changed'));

      await loadNotes();
      await handleSelectNote(fullPath);
    } catch (e) {
      setError(String(e));
    }
  }

  function handleContextMenu(e: React.MouseEvent, path: string) {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, path });
  }

  function startRename(path: string) {
    const note = notes.find(n => n.path === path);
    if (!note) return;
    setRenamingNote(path);
    setRenameValue(note.title);
    setContextMenu(null);
  }

  async function commitRename(path: string) {
    if (!renameValue.trim()) {
      setRenamingNote(null);
      return;
    }

    try {
      const raw = await invoke<string>('read_note', { path });
      let { frontmatter, body: b } = splitFrontmatter(raw);
      frontmatter = updateFrontmatterField(frontmatter, 'title', `"${renameValue.trim()}"`);
      frontmatter = updateFrontmatterField(frontmatter, 'updated', new Date().toISOString());
      await invoke('write_note', { path, content: joinFrontmatter(frontmatter, b) });

      if (activeNote === path) {
        fmRef.current = frontmatter;
        setMeta(prev => ({ ...prev, title: renameValue.trim() }));
      }
    } catch {}

    setRenamingNote(null);
    await loadNotes();
  }

  const handleExportMd = useCallback(async () => {
    if (!activeNote) return;
    const content = joinFrontmatter(fmRef.current, body);
    try {
      const dest = await save({
        filters: [{ name: 'Markdown', extensions: ['md'] }],
        defaultPath: `${meta.title}.md`,
      });
      if (dest) await invoke('write_note', { path: dest, content });
    } catch {}
  }, [activeNote, meta.title, body]);

  const handlePrint = useCallback(async () => {
    const editorEl = document.querySelector('.ProseMirror');
    if (!editorEl || !dataDir) return;

    const clone = editorEl.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('[contenteditable]').forEach(el => el.removeAttribute('contenteditable'));
    clone.querySelectorAll('.image-align-toolbar, .image-resize-handle, .react-renderer:not([data-type="image"])').forEach(el => el.remove());
    clone.querySelectorAll('.image-caption-input').forEach(el => {
      const span = document.createElement('span');
      span.style.cssText = 'display:block;text-align:center;font-style:italic;font-size:0.85em;color:#666;margin-top:4px;';
      span.textContent = (el as HTMLInputElement).value;
      if (span.textContent) el.replaceWith(span);
      else el.remove();
    });
    clone.querySelectorAll('input[type="checkbox"]').forEach(el => {
      const cb = el as HTMLInputElement;
      const span = document.createElement('span');
      span.textContent = cb.checked ? '☑' : '☐';
      span.style.cssText = 'font-size:1.1em;margin-right:4px;';
      cb.replaceWith(span);
    });

    let content = clone.innerHTML;
    content = content.replace(/https?:\/\/asset\.localhost/g, 'file://');
    content = content.replace(/asset:\/\/localhost/g, 'file://');

    const noteEntry = notes.find(n => n.path === activeNote);
    const createdDate = noteEntry?.created?.slice(0, 10) || '';

    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    const metaParts: string[] = [];
    if (meta.project.length > 0) metaParts.push(`<span class="meta-label">Project</span> ${meta.project.map(esc).join(', ')}`);
    if (meta.topic) metaParts.push(`<span class="meta-label">Topic</span> ${esc(meta.topic)}`);
    if (createdDate) metaParts.push(`<span class="meta-label">Date</span> ${esc(createdDate)}`);
    const tagHtml = meta.tags.length > 0
      ? `<div class="print-tags">${meta.tags.map(t => `<span class="tag">${esc(t)}</span>`).join(' ')}</div>`
      : '';

    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${esc(meta.title)}</title>
<style>
@page{size:A4;margin:2cm 1.8cm}
body{font-family:'Malgun Gothic',system-ui,-apple-system,'Segoe UI',sans-serif;max-width:780px;margin:0 auto;padding:1cm;color:#222;font-size:10.5pt;line-height:1.7}
.print-header{margin-bottom:1.5rem;padding-bottom:1rem;border-bottom:2px solid #333}
.print-header h1{font-size:17pt;font-weight:700;margin:0 0 .5rem;color:#111}
.print-meta{display:flex;flex-wrap:wrap;gap:.4rem 1.2rem;font-size:8.5pt;color:#555}
.meta-label{font-weight:600;color:#333;margin-right:2px}
.print-tags{margin-top:.4rem}
.tag{display:inline-block;padding:1px 6px;font-size:8pt;border:1px solid #ccc;border-radius:10px;color:#555;margin-right:4px}
h2{font-size:13pt;font-weight:600;margin:1.2rem 0 .4rem;color:#111}
h3{font-size:11.5pt;font-weight:600;margin:1rem 0 .3rem;color:#222}
h4{font-size:10.5pt;font-weight:600;margin:.8rem 0 .3rem}
table{border-collapse:collapse;width:100%;margin:.6rem 0;page-break-inside:avoid;font-size:9.5pt}
td,th{border:1px solid #bbb;padding:4pt 6pt;vertical-align:top}
th{background:#f0f0f0;font-weight:600;text-align:left}
img{max-width:100%;height:auto;border-radius:4px;page-break-inside:avoid}
blockquote{border-left:3px solid #999;padding-left:10pt;color:#444;margin:0.5rem 0;margin-left:0;page-break-inside:avoid}
code{background:#f4f4f4;padding:1pt 3pt;border-radius:2pt;font-size:9pt;font-family:Consolas,'Courier New',monospace}
pre{background:#f7f7f7;border:1px solid #ddd;padding:8pt 10pt;border-radius:4pt;overflow-x:auto;page-break-inside:avoid;margin:.5rem 0}
pre code{background:none;padding:0;font-size:8.5pt;line-height:1.5}
a{color:#333;text-decoration:underline}
hr{border:none;border-top:1px solid #ccc;margin:1.2rem 0}
ul,ol{padding-left:1.5rem;margin:.3rem 0}
li{margin:.15rem 0}
ul[data-type="taskList"]{list-style:none;padding-left:0}
ul[data-type="taskList"] li{display:flex;align-items:flex-start;gap:.4rem;margin:.2rem 0}
mark{background:#fff3a8;padding:0 2px;border-radius:2px;-webkit-print-color-adjust:exact;print-color-adjust:exact}
p{margin:.25rem 0}
.md-columns{display:flex;gap:14pt;page-break-inside:avoid}
.md-column{flex:1 1 0;min-width:0}
.md-toggle-arrow{display:none}
.md-toggle > *:nth-child(n+3){margin-left:14pt}
.md-callout{position:relative;margin:6pt 0;padding:6pt 8pt 6pt 24pt;border-radius:6pt;background:#f4f4f4;page-break-inside:avoid;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.md-callout::before{content:attr(data-emoji);position:absolute;left:7pt;top:5pt}
.katex,.math-display{page-break-inside:avoid}
@media print{
  body{margin:0;padding:0}
  .print-header{border-bottom-color:#333;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  th{background:#f0f0f0 !important;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  mark{background:#fff3a8 !important;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  h2,h3,h4{page-break-after:avoid}
  table,pre,blockquote,img{page-break-inside:avoid}
  a[href]:after{content:none}
}
</style></head><body>
<div class="print-header">
<h1>${esc(meta.title)}</h1>
${metaParts.length > 0 ? `<div class="print-meta">${metaParts.join('')}</div>` : ''}
${tagHtml}
</div>
${content}
<script>window.onload=function(){window.print()}<\/script>
</body></html>`;

    try {
      const tmpPath = await join(dataDir, 'print-preview.html');
      await invoke('write_note', { path: tmpPath, content: html });
      await invoke('open_path', { path: tmpPath });
    } catch (e) {
      console.error('Print export failed:', e);
    }
  }, [meta, activeNote, notes, dataDir]);

  const renderNoteItem = (note: NoteEntry, indent = 0) => (
    <div key={note.path} className="relative group">
      {renamingNote === note.path ? (
        <div className="px-3 py-2 border-b border-border/30" style={indent ? { paddingLeft: 10 + indent * 12 } : undefined}>
          <input
            autoFocus
            value={renameValue}
            onChange={e => setRenameValue(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') commitRename(note.path);
              if (e.key === 'Escape') setRenamingNote(null);
            }}
            onBlur={() => commitRename(note.path)}
            className="w-full text-xs px-2 py-1 rounded border border-chrome bg-paper-soft text-ink focus:outline-none"
          />
        </div>
      ) : (
        <button
          onClick={() => handleSelectNote(note.path)}
          onContextMenu={(e) => handleContextMenu(e, note.path)}
          className={`w-full text-left px-2.5 py-2 text-sm border-b border-border/30 transition-colors ${
            activeNote === note.path
              ? 'bg-chrome/20 text-ink'
              : 'text-ink-2 hover:bg-paper-soft'
          }`}
          style={indent ? { paddingLeft: 10 + indent * 12 } : undefined}
        >
          <div className="font-medium text-xs truncate pr-6">
            <span className="mr-0.5">{note.icon || (typeIconMap[note.noteType] ?? NOTE_TYPE_ICONS[note.noteType as NoteType] ?? '📝')}</span>
            {note.title}
          </div>
          {note.updated && (
            <div className="text-[10px] text-ink-3 mt-0.5 truncate pr-6">
              {formatRelativeTime(note.updated)}
            </div>
          )}
        </button>
      )}
      {renamingNote !== note.path && (
        <div className="absolute right-1 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 flex gap-0.5 transition-opacity">
          <button
            onClick={(e) => { e.stopPropagation(); startRename(note.path); }}
            title="Rename"
            className="p-1 rounded text-ink-3 hover:text-ink hover:bg-paper-soft transition-colors"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M8.5 1.5l2 2L4 10H2v-2l6.5-6.5z" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); handleDelete(note.path); }}
            title="Delete"
            className="p-1 rounded text-ink-3 hover:text-red-400 hover:bg-paper-soft transition-colors"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
            </svg>
          </button>
        </div>
      )}
    </div>
  );

  return (
    <div className="flex-1 flex min-h-0 min-w-0">
      {listHidden && (
        <div className="w-6 shrink-0 border-r border-border bg-paper-soft/40 flex flex-col items-center pt-1.5 gap-0.5">
          <button
            onClick={toggleListHidden}
            title="노트 목록 표시"
            className="p-1 rounded text-ink-3 hover:text-ink hover:bg-paper-muted/60 transition-colors"
          >
            <svg width="11" height="11" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 3l4 4-4 4M8 3l4 4-4 4" />
            </svg>
          </button>
          <button
            onClick={() => handleCreate()}
            title="새 노트"
            className="p-1 rounded text-ink-3 hover:text-ink hover:bg-paper-muted/60 transition-colors"
          >
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M6 2v8M2 6h8" />
            </svg>
          </button>
          <div className="w-3 border-t border-border/60 my-1" />
          {/* 이전/다음 노트 이동 — 목록 없이도 노트 사이를 순회 */}
          <button
            onClick={() => navigateNote(-1)}
            title="이전 노트"
            className="p-1 rounded text-ink-3 hover:text-ink hover:bg-paper-muted/60 transition-colors disabled:opacity-30"
            disabled={filteredNotes.length === 0}
          >
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 7.5L6 4.5l3 3" />
            </svg>
          </button>
          <button
            onClick={() => navigateNote(1)}
            title="다음 노트"
            className="p-1 rounded text-ink-3 hover:text-ink hover:bg-paper-muted/60 transition-colors disabled:opacity-30"
            disabled={filteredNotes.length === 0}
          >
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 4.5l3 3 3-3" />
            </svg>
          </button>
          <span
            className="mt-2 text-[9px] text-ink-3 tracking-widest select-none"
            style={{ writingMode: 'vertical-rl' }}
            title={`노트 ${filteredNotes.length}개`}
          >
            NOTES {filteredNotes.length}
          </span>
        </div>
      )}
      <div style={{ width: listWidth, display: listHidden ? 'none' : undefined }} className="shrink-0 border-r border-border flex flex-col">
        <div className="px-2.5 py-2 border-b border-border flex items-center justify-between">
          <span className="text-xs font-medium text-ink-2">Research Notes</span>
          <div className="flex items-center gap-1">
            <button
              onClick={toggleListHidden}
              title="노트 목록 숨기기"
              className="p-1 rounded text-ink-3 hover:text-ink hover:bg-paper-soft transition-colors"
            >
              <svg width="11" height="11" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10 3L6 7l4 4M6 3L2 7l4 4" />
              </svg>
            </button>
            <button
              onClick={() => setShowTemplateEditor(true)}
              title="Edit Templates"
              className="p-1 rounded text-ink-3 hover:text-ink hover:bg-paper-soft transition-colors"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M10 6.5V10a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1h3.5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M8.5 1.5l2 2L5 9H3V7l5.5-5.5z" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <div className="relative">
              <button
                onClick={(e) => { e.stopPropagation(); setShowTemplateMenu(!showTemplateMenu); }}
                className="px-2 py-1 text-xs rounded-lg bg-chrome/30 text-ink hover:bg-chrome/50 transition-colors"
              >
                + New
              </button>
              {showTemplateMenu && (
                <div className="absolute right-0 top-full mt-1 z-50 bg-paper border border-border rounded-lg shadow-lg py-1 min-w-[140px]">
                  {activeTemplates.map(t => (
                    <button
                      key={t.id}
                      onClick={() => handleCreate(t)}
                      className="w-full text-left px-3 py-1.5 text-xs text-ink-2 hover:bg-paper-soft transition-colors"
                    >
                      {t.icon} {t.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
        {error && <p className="px-2.5 py-1 text-[10px] text-red-500 break-all">{error}</p>}

        <div className="px-2 py-1.5 border-b border-border/50 space-y-1">
          <div className="flex gap-1">
            <Dropdown
              value={filterProject}
              onChange={setFilterProject}
              options={allProjects.map(p => ({ value: p, label: p }))}
              placeholder="All Projects"
              compact
              className="flex-1 min-w-0"
            />
            <Dropdown
              value={filterTag}
              onChange={setFilterTag}
              options={allTags.map(t => ({ value: t, label: t }))}
              placeholder="All Tags"
              compact
              className="flex-1 min-w-0"
            />
          </div>
          <div className="flex gap-0.5 items-center">
            {(['updated', 'created', 'title'] as const).map(s => (
              <button
                key={s}
                onClick={() => setSortBy(s)}
                className={`px-1.5 py-0.5 text-[9px] rounded transition-colors ${
                  sortBy === s ? 'bg-chrome/30 text-ink font-medium' : 'text-ink-3 hover:bg-paper-soft'
                }`}
              >
                {s === 'updated' ? 'Recent' : s === 'created' ? 'Created' : 'A-Z'}
              </button>
            ))}
            <button
              onClick={toggleGroupView}
              title="프로젝트/Experiment별 그룹"
              className={`ml-auto px-1.5 py-0.5 text-[9px] rounded transition-colors flex items-center gap-0.5 ${
                groupView ? 'bg-chrome/30 text-ink font-medium' : 'text-ink-3 hover:bg-paper-soft'
              }`}
            >
              <svg width="9" height="9" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
                <path d="M2 3h8M4 6h6M6 9h4" />
              </svg>
              그룹
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto relative">
          {filteredNotes.length === 0 && (
            <p className="text-xs text-ink-3 text-center py-4">
              {notes.length === 0 ? 'No research notes yet.' : 'No notes match filters.'}
            </p>
          )}
          {!groupView && filteredNotes.map((note) => renderNoteItem(note))}

          {groupView && groupedNotes && groupedNotes.map((g) => {
            const pKey = `p:${g.project}`;
            const pCollapsed = collapsedGroups.has(pKey);
            const projColor = projects.find(p => p.name === g.project)?.color;
            const count = g.direct.length + g.experiments.reduce((s, e) => s + e.notes.length, 0);
            return (
              <div key={g.project}>
                <button
                  onClick={() => toggleGroup(pKey)}
                  className="w-full flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-semibold text-ink-2 bg-paper-soft/70 border-b border-border/30 sticky top-0 z-10 hover:bg-paper-soft transition-colors"
                >
                  <svg width="8" height="8" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
                    className={`shrink-0 transition-transform ${pCollapsed ? '' : 'rotate-90'}`}>
                    <path d="M3 1.5L7.5 5 3 8.5" />
                  </svg>
                  {projColor && <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: projColor }} />}
                  <span className="truncate">{g.project}</span>
                  <span className="ml-auto text-[9px] text-ink-3 font-normal shrink-0">{count}</span>
                </button>
                {!pCollapsed && (
                  <>
                    {g.direct.map(n => renderNoteItem(n, 1))}
                    {g.experiments.map(ex => {
                      const eKey = `p:${g.project}/e:${ex.name}`;
                      const eCollapsed = collapsedGroups.has(eKey);
                      return (
                        <div key={ex.name}>
                          <button
                            onClick={() => toggleGroup(eKey)}
                            className="w-full flex items-center gap-1 pr-2.5 py-1 text-[10px] font-medium text-ink-3 border-b border-border/20 hover:bg-paper-soft/50 transition-colors"
                            style={{ paddingLeft: 22 }}
                          >
                            <svg width="7" height="7" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
                              className={`shrink-0 transition-transform ${eCollapsed ? '' : 'rotate-90'}`}>
                              <path d="M3 1.5L7.5 5 3 8.5" />
                            </svg>
                            <span className="mr-0.5">{experimentEmoji(ex.name)}</span>
                            <span className="truncate">{ex.name}</span>
                            <span className="ml-auto text-[9px] shrink-0">{ex.notes.length}</span>
                          </button>
                          {!eCollapsed && ex.notes.map(n => renderNoteItem(n, 2))}
                        </div>
                      );
                    })}
                  </>
                )}
              </div>
            );
          })}

          {contextMenu && (() => {
            const ctxNote = notes.find(n => n.path === contextMenu.path);
            const wasPromoted = ctxNote ? notes.some(n => n.id !== ctxNote.id && n.related.includes(ctxNote.id)) : false;
            const isQuickMemo = ctxNote?.noteType === 'quick-memo' && !wasPromoted;
            const promoteTargets: { type: NoteType; label: string; icon: string }[] = [
              { type: 'analysis-note', label: 'Analysis Note', icon: '📊' },
              { type: 'design-note', label: 'Design Note', icon: '📐' },
              { type: 'study-note', label: 'Study Note', icon: '📚' },
              { type: 'test-log', label: 'Test Log', icon: '🔧' },
            ];
            return (
              <div
                className="fixed z-50 bg-paper border border-border rounded-lg shadow-lg py-1 min-w-[140px]"
                style={{ left: contextMenu.x, top: contextMenu.y }}
              >
                <button
                  onClick={() => startRename(contextMenu.path)}
                  className="w-full text-left px-3 py-1.5 text-xs text-ink hover:bg-paper-soft transition-colors"
                >
                  Rename
                </button>
                {isQuickMemo && (
                  <>
                    <div className="mx-2 my-0.5 border-t border-border/50" />
                    <div className="px-3 py-1 text-[10px] text-ink-3 uppercase tracking-wider">Promote to</div>
                    {promoteTargets.map(t => (
                      <button
                        key={t.type}
                        onClick={() => { handlePromote(contextMenu.path, t.type); setContextMenu(null); }}
                        className="w-full text-left px-3 py-1.5 text-xs text-ink hover:bg-paper-soft transition-colors"
                      >
                        {t.icon} {t.label}
                      </button>
                    ))}
                  </>
                )}
                <div className="mx-2 my-0.5 border-t border-border/50" />
                <button
                  onClick={() => { handleDelete(contextMenu.path); setContextMenu(null); }}
                  className="w-full text-left px-3 py-1.5 text-xs text-red-500 hover:bg-paper-soft transition-colors"
                >
                  Delete
                </button>
              </div>
            );
          })()}
        </div>
      </div>

      {!listHidden && <ResizeHandle onResize={handleListResize} />}

      <div className="flex-1 flex flex-col min-h-0 min-w-0">
        {activeNote ? (
          <>
            {conflictNote && (
              <div className="px-4 py-1.5 bg-pastel-cream/50 border-b border-pastel-cream flex items-center justify-between shrink-0">
                <span className="text-xs text-ink-2">This note was modified externally.</span>
                <div className="flex gap-1.5">
                  <button
                    onClick={() => { handleSelectNote(activeNote); }}
                    className="px-2 py-0.5 text-[10px] rounded bg-chrome/30 text-ink font-medium hover:bg-chrome/50 transition-colors"
                  >
                    Reload
                  </button>
                  <button
                    onClick={() => setConflictNote(false)}
                    className="px-2 py-0.5 text-[10px] rounded text-ink-3 hover:bg-paper-muted/50 transition-colors"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            )}
            <div className="pl-10 pr-6 py-3.5 border-b border-border bg-paper shrink-0 space-y-2.5">
              <div className="flex items-center gap-2">
                <div className="relative shrink-0">
                  <button
                    onClick={() => { setIconPickerOpen(v => !v); setIconInput(''); }}
                    title="노트 아이콘 설정"
                    className="px-1.5 py-0.5 text-base rounded hover:bg-paper-soft transition-colors"
                  >
                    {noteIcon || typeIconMap[notes.find(n => n.path === activeNote)?.noteType ?? ''] || '📝'}
                  </button>
                  {iconPickerOpen && (
                    <div className="absolute top-full left-0 mt-1 z-50 bg-paper border border-border rounded-lg shadow-lg p-2 w-44">
                      <div className="text-[10px] text-ink-3 mb-1">이모지 입력 후 Enter</div>
                      <input
                        autoFocus
                        value={iconInput}
                        onChange={e => setIconInput(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter' && iconInput.trim()) updateNoteIcon(iconInput);
                          if (e.key === 'Escape') setIconPickerOpen(false);
                        }}
                        placeholder="🛰️"
                        className="w-full text-sm px-2 py-1 rounded border border-border bg-paper text-ink outline-none focus:border-chrome"
                      />
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {['🛰️', '🔭', '📡', '🧪', '📐', '🧭', '⚙️', '🗂️', '💡', '⭐'].map(em => (
                          <button
                            key={em}
                            onClick={() => updateNoteIcon(em)}
                            className="w-6 h-6 rounded hover:bg-paper-soft transition-colors"
                          >
                            {em}
                          </button>
                        ))}
                      </div>
                      {noteIcon && (
                        <button
                          onClick={() => updateNoteIcon('')}
                          className="mt-1.5 w-full text-[10px] text-ink-3 hover:text-ink-2 py-0.5 rounded border border-border/60 hover:bg-paper-soft transition-colors"
                        >
                          기본 아이콘으로
                        </button>
                      )}
                    </div>
                  )}
                </div>
                <input
                  value={meta.title}
                  onChange={e => updateMeta('title', e.target.value)}
                  placeholder="Note title"
                  className="flex-1 text-base font-semibold text-ink bg-paper-soft/40 rounded px-3 py-1 border border-transparent outline-none focus:border-border placeholder:text-ink-3"
                />
                <button
                  onClick={() => {
                    if (!activeNoteId) return;
                    const label = (meta.title || activeNoteId).replace(/([\[\]])/g, '\\$1');
                    navigator.clipboard.writeText(`[${label}](note://${activeNoteId})`).catch(() => {});
                    setNoteLinkCopied(true);
                    setTimeout(() => setNoteLinkCopied(false), 1500);
                  }}
                  title="노트 링크 복사 — 다른 노트에서 우클릭 > 링크 삽입 또는 붙여넣기"
                  className="px-1.5 py-0.5 text-[10px] rounded text-ink-3 hover:bg-paper-soft hover:text-ink-2 transition-colors shrink-0"
                >
                  {noteLinkCopied ? '✓' : '🔗'}
                </button>
                <button
                  onClick={() => setLinksPanelOpen(v => !v)}
                  title={linksPanelOpen ? 'Hide links panel' : 'Show links panel'}
                  className={`px-1.5 py-0.5 text-[10px] rounded transition-colors shrink-0 ${linksPanelOpen ? 'bg-chrome/20 text-ink' : 'text-ink-3 hover:bg-paper-soft hover:text-ink-2'}`}
                >
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M7 2L4 2a2 2 0 0 0-2 2v3a2 2 0 0 0 2 2h1" />
                    <path d="M9 14h3a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-1" />
                    <path d="M6 10l4-4" />
                  </svg>
                </button>
                <button
                  onClick={handleExportMd}
                  title="Export as Markdown"
                  className="px-1.5 py-0.5 text-[10px] rounded text-ink-3 hover:bg-paper-soft hover:text-ink-2 transition-colors shrink-0"
                >
                  .md
                </button>
                <button
                  onClick={handlePrint}
                  title="Print / Save as PDF"
                  className="px-1.5 py-0.5 text-[10px] rounded text-ink-3 hover:bg-paper-soft hover:text-ink-2 transition-colors shrink-0"
                >
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 4V2h8v2" />
                    <rect x="2" y="6" width="12" height="6" rx="1" />
                    <path d="M4 12v2h8v-2" />
                  </svg>
                </button>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1.5 relative">
                  <span className="text-[10px] text-ink-3 uppercase tracking-wider">Project</span>
                  <input
                    value={meta.project.join(', ')}
                    onChange={e => {
                      const val = e.target.value;
                      updateMeta('project', val ? val.split(',').map(s => s.trim()).filter(Boolean) : []);
                      setProjectDropdownOpen(true);
                    }}
                    onFocus={() => setProjectDropdownOpen(true)}
                    onBlur={() => setTimeout(() => setProjectDropdownOpen(false), 150)}
                    placeholder="—"
                    className="text-xs text-ink-2 bg-paper-soft/40 rounded px-2 py-1 border border-transparent outline-none focus:border-border w-28 placeholder:text-ink-3"
                  />
                  {projectDropdownOpen && (() => {
                    const q = meta.project.join(' ').toLowerCase();
                    const filtered = projects.filter(p => !q || p.name.toLowerCase().includes(q));
                    if (filtered.length === 0) return null;
                    return (
                      <div className="absolute top-full left-0 mt-1 z-50 bg-paper border border-border rounded-lg shadow-lg py-1 min-w-[140px] max-h-32 overflow-y-auto">
                        {filtered.map(p => (
                          <button
                            key={p.id}
                            onMouseDown={e => {
                              e.preventDefault();
                              const cur = meta.project;
                              const next = cur.includes(p.name) ? cur.filter(x => x !== p.name) : [...cur, p.name];
                              updateMeta('project', next);
                              setProjectDropdownOpen(false);
                            }}
                            className="w-full text-left px-2 py-1 text-xs text-ink-2 hover:bg-paper-soft flex items-center gap-1.5 transition-colors"
                          >
                            <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: p.color }} />
                            {p.name}
                            {meta.project.includes(p.name) && <span className="ml-auto text-chrome">✓</span>}
                          </button>
                        ))}
                      </div>
                    );
                  })()}
                </div>
                <div className="w-px h-3 bg-border" />
                <div className="flex items-center gap-1.5 flex-1 min-w-0 relative">
                  <span className="text-[10px] text-ink-3 uppercase tracking-wider shrink-0">Tags</span>
                  <div className="flex items-center gap-1 flex-wrap min-w-0">
                    {meta.tags.map(tag => (
                      <span
                        key={tag}
                        className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] rounded-full text-tag-text"
                        style={{ background: tagBg(tag) }}
                      >
                        {tag}
                        <button
                          onClick={() => handleRemoveTag(tag)}
                          className="text-ink-3 hover:text-ink ml-0.5"
                        >
                          ×
                        </button>
                      </span>
                    ))}
                    <input
                      value={tagInput}
                      onChange={e => { setTagInput(e.target.value); setTagDropdownOpen(true); setTagHighlight(0); }}
                      onFocus={() => setTagDropdownOpen(true)}
                      onBlur={() => setTimeout(() => setTagDropdownOpen(false), 150)}
                      onKeyDown={e => {
                        if (tagDropdownOpen && tagSuggestions.length > 0) {
                          if (e.key === 'ArrowDown') { e.preventDefault(); setTagHighlight(i => (i + 1) % tagSuggestions.length); return; }
                          if (e.key === 'ArrowUp') { e.preventDefault(); setTagHighlight(i => (i - 1 + tagSuggestions.length) % tagSuggestions.length); return; }
                          if ((e.key === 'Enter' || e.key === 'Tab') && tagSuggestions[tagHighlight]) { e.preventDefault(); handleAddTag(tagSuggestions[tagHighlight].name); return; }
                          if (e.key === 'Escape') { e.preventDefault(); setTagDropdownOpen(false); return; }
                        }
                        if (e.key === 'Enter') { e.preventDefault(); handleAddTag(); }
                        if (e.key === 'Backspace' && !tagInput && meta.tags.length > 0) {
                          handleRemoveTag(meta.tags[meta.tags.length - 1]);
                        }
                      }}
                      placeholder={meta.tags.length === 0 ? 'Add tag...' : ''}
                      className="text-[10px] text-ink-2 bg-paper-soft/40 rounded px-2 py-1 border border-transparent outline-none focus:border-border w-20 placeholder:text-ink-3"
                    />
                  </div>
                  {tagDropdownOpen && tagSuggestions.length > 0 && (
                    <div className="absolute left-0 top-full mt-1 z-50 bg-paper border border-border rounded-lg shadow-lg py-1 min-w-[140px] max-h-32 overflow-y-auto">
                      {tagSuggestions.map((s, i) => (
                        <button
                          key={s.name}
                          onMouseDown={e => { e.preventDefault(); handleAddTag(s.name); }}
                          className={`w-full text-left px-2 py-1 text-xs flex items-center justify-between transition-colors ${
                            i === tagHighlight ? 'bg-chrome/15 text-ink' : 'text-ink-2 hover:bg-paper-soft'
                          }`}
                        >
                          <span>{s.name}</span>
                          <span className="text-[9px] text-ink-3">{s.count}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1.5 relative">
                  <span className="text-[10px] text-ink-3 uppercase tracking-wider">Topic</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); setTopicDropdownOpen(v => !v); setShowNewTopicInput(false); }}
                    className="text-xs text-ink-2 bg-paper-soft/40 rounded px-2 py-1 border border-transparent hover:border-border w-36 text-left truncate placeholder:text-ink-3"
                  >
                    {meta.topic || <span className="text-ink-3">—</span>}
                  </button>
                  {topicDropdownOpen && (
                    <div className="absolute top-full left-0 mt-1 z-50 bg-paper border border-border rounded-lg shadow-lg py-1 min-w-[180px] max-h-48 overflow-y-auto"
                      onClick={e => e.stopPropagation()}>
                      {meta.topic && (
                        <button
                          onMouseDown={e => {
                            e.preventDefault();
                            const prev = meta.topic;
                            updateMeta('topic', '');
                            if (prev) updateTopicsFile('', meta.project, meta.subsystem, prev);
                            setTopicDropdownOpen(false);
                          }}
                          className="w-full text-left px-2 py-1 text-xs text-ink-3 hover:bg-paper-soft transition-colors italic"
                        >
                          Clear topic
                        </button>
                      )}
                      {topics.filter(t => !meta.project.length || meta.project.includes(t.project) || !t.project).map(t => (
                        <button
                          key={t.name}
                          onMouseDown={e => {
                            e.preventDefault();
                            const prev = meta.topic;
                            updateMeta('topic', t.name);
                            updateTopicsFile(t.name, meta.project, meta.subsystem, prev);
                            setTopicDropdownOpen(false);
                          }}
                          className={`w-full text-left px-2 py-1 text-xs hover:bg-paper-soft transition-colors flex items-center justify-between ${
                            meta.topic === t.name ? 'text-ink font-medium' : 'text-ink-2'
                          }`}
                        >
                          <span className="truncate">{t.name}</span>
                          <span className="text-[9px] text-ink-3 ml-1 shrink-0">{t.note_count}</span>
                        </button>
                      ))}
                      {topics.filter(t => meta.project.length && t.project && !meta.project.includes(t.project)).length > 0 && (
                        <>
                          <div className="mx-2 my-0.5 border-t border-border/50" />
                          <div className="px-2 py-0.5 text-[9px] text-ink-3">Other projects</div>
                          {topics.filter(t => meta.project.length > 0 && t.project && !meta.project.includes(t.project)).map(t => (
                            <button
                              key={t.name}
                              onMouseDown={e => {
                                e.preventDefault();
                                const prev = meta.topic;
                                updateMeta('topic', t.name);
                                updateTopicsFile(t.name, meta.project, meta.subsystem, prev);
                                setTopicDropdownOpen(false);
                              }}
                              className="w-full text-left px-2 py-1 text-xs text-ink-3 hover:bg-paper-soft transition-colors flex items-center justify-between"
                            >
                              <span className="truncate">{t.name}</span>
                              <span className="text-[9px] text-ink-3 ml-1 shrink-0">{t.project}</span>
                            </button>
                          ))}
                        </>
                      )}
                      <div className="mx-2 my-0.5 border-t border-border/50" />
                      {showNewTopicInput ? (
                        <div className="px-2 py-1 flex gap-1">
                          <input
                            autoFocus
                            value={newTopicName}
                            onChange={e => setNewTopicName(e.target.value)}
                            onKeyDown={e => {
                              if (e.key === 'Enter' && newTopicName.trim()) {
                                const prev = meta.topic;
                                updateMeta('topic', newTopicName.trim());
                                updateTopicsFile(newTopicName.trim(), meta.project, meta.subsystem, prev);
                                setNewTopicName('');
                                setShowNewTopicInput(false);
                                setTopicDropdownOpen(false);
                              }
                              if (e.key === 'Escape') { setShowNewTopicInput(false); setNewTopicName(''); }
                            }}
                            placeholder="Topic name..."
                            className="flex-1 text-xs px-1.5 py-0.5 rounded border border-border bg-paper-soft text-ink focus:outline-none min-w-0"
                          />
                        </div>
                      ) : (
                        <button
                          onMouseDown={e => { e.preventDefault(); setShowNewTopicInput(true); }}
                          className="w-full text-left px-2 py-1 text-xs text-chrome hover:bg-paper-soft transition-colors"
                        >
                          + New Topic
                        </button>
                      )}
                    </div>
                  )}
                </div>
                <div className="w-px h-3 bg-border" />
                <div className="flex items-center gap-1.5 relative">
                  <span className="text-[10px] text-ink-3 uppercase tracking-wider">Experiment</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); setExperimentDropdownOpen(v => !v); setShowNewExperimentInput(false); }}
                    className="text-xs text-ink-2 bg-paper-soft/40 rounded px-2 py-1 border border-transparent hover:border-border w-36 text-left truncate placeholder:text-ink-3"
                  >
                    {meta.experiment || <span className="text-ink-3">—</span>}
                  </button>
                  {experimentDropdownOpen && (
                    <div className="absolute top-full left-0 mt-1 z-50 bg-paper border border-border rounded-lg shadow-lg py-1 min-w-[180px] max-h-48 overflow-y-auto"
                      onClick={e => e.stopPropagation()}>
                      {meta.experiment && (
                        <button
                          onMouseDown={e => {
                            e.preventDefault();
                            updateMeta('experiment', '');
                            setExperimentDropdownOpen(false);
                          }}
                          className="w-full text-left px-2 py-1 text-xs text-ink-3 hover:bg-paper-soft transition-colors italic"
                        >
                          Clear experiment
                        </button>
                      )}
                      {relevantExperiments.map(ex => (
                        <button
                          key={ex.id}
                          onMouseDown={e => {
                            e.preventDefault();
                            updateMeta('experiment', ex.name);
                            setExperimentDropdownOpen(false);
                          }}
                          className={`w-full text-left px-2 py-1 text-xs hover:bg-paper-soft transition-colors flex items-center justify-between ${
                            meta.experiment === ex.name ? 'text-ink font-medium' : 'text-ink-2'
                          }`}
                        >
                          <span className="truncate">{ex.name}</span>
                          {ex.status !== 'active' && (
                            <span className="text-[9px] text-ink-3 ml-1 shrink-0">{ex.status === 'done' ? '완료' : '보관'}</span>
                          )}
                        </button>
                      ))}
                      {relevantExperiments.length === 0 && (
                        <div className="px-2 py-1 text-[10px] text-ink-3">No experiments yet</div>
                      )}
                      <div className="mx-2 my-0.5 border-t border-border/50" />
                      {showNewExperimentInput ? (
                        <div className="px-2 py-1 flex gap-1">
                          <input
                            autoFocus
                            value={newExperimentName}
                            onChange={e => setNewExperimentName(e.target.value)}
                            onKeyDown={e => {
                              if (e.key === 'Enter' && newExperimentName.trim()) {
                                handleCreateExperiment(newExperimentName);
                                setNewExperimentName('');
                                setShowNewExperimentInput(false);
                                setExperimentDropdownOpen(false);
                              }
                              if (e.key === 'Escape') { setShowNewExperimentInput(false); setNewExperimentName(''); }
                            }}
                            placeholder="Experiment name..."
                            className="flex-1 text-xs px-1.5 py-0.5 rounded border border-border bg-paper-soft text-ink focus:outline-none min-w-0"
                          />
                        </div>
                      ) : noteProjectIds.length > 0 ? (
                        <button
                          onMouseDown={e => { e.preventDefault(); setShowNewExperimentInput(true); }}
                          className="w-full text-left px-2 py-1 text-xs text-chrome hover:bg-paper-soft transition-colors"
                        >
                          + New Experiment
                        </button>
                      ) : (
                        <div className="px-2 py-1 text-[10px] text-ink-3 italic">프로젝트를 먼저 지정하세요</div>
                      )}
                    </div>
                  )}
                </div>
                <div className="w-px h-3 bg-border" />
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-ink-3 uppercase tracking-wider">Status</span>
                  <Dropdown
                    value={meta.status ?? 'draft'}
                    onChange={v => updateMeta('status', v)}
                    options={[
                      { value: 'draft', label: 'Draft' },
                      { value: 'in-progress', label: 'In Progress' },
                      { value: 'complete', label: 'Complete' },
                      { value: 'archived', label: 'Archived' },
                    ]}
                    placeholder="Status"
                    compact
                  />
                </div>
              </div>
            </div>
            <AutoSuggestionBanner
              noteType={(() => {
                const n = notes.find(n => n.path === activeNote);
                return n?.noteType ?? 'analysis-note';
              })()}
              noteId={activeNoteId}
              status={meta.status}
              verdict={(() => {
                const fields = parseFrontmatterFields(fmRef.current);
                return fields.verdict ?? '';
              })()}
              topic={meta.topic}
              body={body}
              tags={meta.tags}
              subsystem={meta.subsystem}
              project={meta.project}
              updatedAt={(() => {
                const fields = parseFrontmatterFields(fmRef.current);
                return fields.updated ?? '';
              })()}
              onUpdateStatus={(s) => updateMeta('status', s)}
              onPromote={(() => {
                const n = notes.find(n => n.path === activeNote);
                if (!n || n.noteType !== 'quick-memo') return undefined;
                const alreadyPromoted = notes.some(other => other.id !== n.id && other.related.includes(n.id));
                if (alreadyPromoted) return undefined;
                return (targetType: NoteType) => { if (activeNote) handlePromote(activeNote, targetType); };
              })()}
              onAddTag={(tag) => handleAddTag(tag)}
              onAddSubsystem={(sub) => {
                if (!meta.subsystem.includes(sub)) {
                  updateMeta('subsystem', [...meta.subsystem, sub]);
                }
              }}
              onUpdateBody={(newBody) => handleChange(newBody)}
              onSetTopic={(t) => {
                const prev = meta.topic;
                updateMeta('topic', t);
                updateTopicsFile(t, meta.project, meta.subsystem, prev);
              }}
            />
            <div className="flex flex-1 min-h-0 overflow-hidden">
              <div className="flex-1 min-w-0 min-h-0 flex flex-col">
                <NoteEditor
                  key={activeNote}
                  content={body}
                  onChange={handleChange}
                  placeholder="Start writing..."
                  sectionGuides={activeGuideMap}
                  noteId={activeNoteId || undefined}
                  scrollAnchor={scrollAnchor}
                  onAnchorScrolled={() => setScrollAnchor(null)}
                />
              </div>
              {activeNoteId && (
                <BacklinkPanel
                  noteId={activeNoteId}
                  onNavigate={handleSelectNote}
                  visible={linksPanelOpen}
                  onToggle={() => setLinksPanelOpen(false)}
                />
              )}
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-ink-3 text-sm">
            Click "+ New" to create a note.
          </div>
        )}
      </div>
      {showTemplateEditor && (
        <TemplateEditor
          onClose={() => setShowTemplateEditor(false)}
          onTemplatesChanged={() => loadCustomTemplates()}
        />
      )}
    </div>
  );
}
