import { useState, useEffect, useCallback, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { join } from '@tauri-apps/api/path';
import { useAppStore } from '../../stores/useAppStore';
import { useProjectStore } from '../../stores/useProjectStore';
import { readJsonFile } from '../../lib/fileSystem';
import { FILES, FOLDERS } from '../../lib/constants';
import { buildFrontmatter } from '../../lib/frontmatter';
import { todayKey } from '../../lib/dateUtils';
import { reindexNote } from '../../lib/searchIndex';
import { findNotesForProject, type HubNoteRow } from '../../lib/db';
import type { ProjectsFile } from '../../types/project';
import '../../styles/editor.css';

const SECTIONS = [
  { key: 'overview', label: '프로젝트 개요', icon: '📋', template: overviewTemplate },
  { key: 'hw-spec', label: '하드웨어 사양', icon: '🔧', template: hwSpecTemplate },
  { key: 'orbit', label: '궤도 파라미터', icon: '🌍', template: orbitTemplate },
  { key: 'attitude', label: '자세 모드', icon: '🧭', template: attitudeTemplate },
] as const;

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function inlineFmt(s: string): string {
  return s
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>');
}

function mdToHtml(md: string): string {
  if (!md?.trim()) return '';
  let src = md;
  if (src.startsWith('---')) {
    const end = src.indexOf('---', 3);
    if (end !== -1) src = src.slice(end + 3);
  }
  const lines = src.split('\n');
  const out: string[] = [];
  let inTable = false;
  let inCode = false;
  let inList = false;
  let tblRow = 0;

  for (const line of lines) {
    if (line.startsWith('```')) {
      if (inList) { out.push('</ul>'); inList = false; }
      if (inCode) { out.push('</code></pre>'); inCode = false; }
      else { out.push('<pre><code>'); inCode = true; }
      continue;
    }
    if (inCode) { out.push(escHtml(line) + '\n'); continue; }

    const t = line.trim();
    if (t.startsWith('|') && t.endsWith('|')) {
      if (inList) { out.push('</ul>'); inList = false; }
      if (!inTable) { out.push('<table>'); inTable = true; tblRow = 0; }
      if (/^\|[\s\-:|]+\|$/.test(t)) continue;
      const cells = t.split('|').slice(1, -1).map(c => c.trim());
      const tag = tblRow === 0 ? 'th' : 'td';
      out.push('<tr>' + cells.map(c => `<${tag}>${inlineFmt(escHtml(c))}</${tag}>`).join('') + '</tr>');
      tblRow++;
      continue;
    }
    if (inTable) { out.push('</table>'); inTable = false; }

    const hm = line.match(/^(#{1,6})\s+(.+)$/);
    if (hm) {
      if (inList) { out.push('</ul>'); inList = false; }
      const lvl = Math.min(hm[1].length + 1, 6);
      out.push(`<h${lvl}>${inlineFmt(escHtml(hm[2]))}</h${lvl}>`);
      continue;
    }

    if (line.match(/^\s*[-*+]\s+/)) {
      if (!inList) { out.push('<ul>'); inList = true; }
      const text = line.replace(/^\s*[-*+]\s+/, '');
      if (text) out.push(`<li>${inlineFmt(escHtml(text))}</li>`);
      continue;
    }
    if (inList && t === '') continue;
    if (inList && !line.match(/^\s*[-*+]\s/)) { out.push('</ul>'); inList = false; }

    if (t === '') continue;
    out.push(`<p>${inlineFmt(escHtml(line))}</p>`);
  }

  if (inTable) out.push('</table>');
  if (inCode) out.push('</code></pre>');
  if (inList) out.push('</ul>');
  return out.join('\n');
}

function stripFrontmatter(raw: string): string {
  if (!raw.startsWith('---')) return raw;
  const end = raw.indexOf('---', 3);
  return end !== -1 ? raw.slice(end + 3).trim() : raw;
}

export function DashboardView() {
  const { dataDir, openNote } = useAppStore();
  const { projects, setProjects } = useProjectStore();
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [projectNotes, setProjectNotes] = useState<Record<string, HubNoteRow[]>>({});
  const [noteContents, setNoteContents] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!dataDir) return;
    readJsonFile<ProjectsFile>(dataDir, FILES.projects).then((pf) => {
      if (pf?.projects) setProjects(pf.projects);
    });
  }, [dataDir, setProjects]);

  useEffect(() => {
    if (!activeProjectId && projects.length > 0) {
      setActiveProjectId(projects[0].id);
    }
  }, [projects, activeProjectId]);

  useEffect(() => {
    if (!dataDir || projects.length === 0) { setLoading(false); return; }
    let cancelled = false;
    (async () => {
      setLoading(true);
      const map: Record<string, HubNoteRow[]> = {};
      const contents: Record<string, string> = {};
      for (const p of projects) {
        try {
          const notes = await findNotesForProject(p.name);
          const dashNotes = notes.filter(n => n.note_type === 'project-dashboard');
          const validNotes: HubNoteRow[] = [];
          for (const note of dashNotes) {
            try {
              const raw = await invoke<string>('read_note', { path: note.path });
              contents[note.path] = stripFrontmatter(raw);
              validNotes.push(note);
            } catch { /* file deleted — skip */ }
          }
          map[p.id] = validNotes;
        } catch { map[p.id] = []; }
      }
      if (!cancelled) { setProjectNotes(map); setNoteContents(contents); setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [dataDir, projects, refreshKey]);

  useEffect(() => {
    const handler = () => setRefreshKey(k => k + 1);
    window.addEventListener('notes-changed', handler);
    return () => window.removeEventListener('notes-changed', handler);
  }, []);

  const activeProject = useMemo(
    () => projects.find(p => p.id === activeProjectId) ?? null,
    [projects, activeProjectId],
  );

  const notes = useMemo(
    () => (activeProjectId ? projectNotes[activeProjectId] ?? [] : []),
    [projectNotes, activeProjectId],
  );

  const findNote = useCallback((key: string) => {
    const sec = SECTIONS.find(s => s.key === key);
    return notes.find(n => n.tags?.includes(key) || (sec && n.title.includes(sec.label))) ?? null;
  }, [notes]);

  const handleCreate = useCallback(async (projectName: string, sectionKey: string) => {
    if (!dataDir) return;
    const sec = SECTIONS.find(s => s.key === sectionKey);
    if (!sec) return;
    const today = todayKey();
    const iso = new Date().toISOString();
    const slug = projectName.toLowerCase().replace(/[^a-z0-9가-힣]/g, '-');
    const noteId = `${today}-dashboard-${slug}-${sectionKey}`;
    const title = `${projectName} — ${sec.label}`;
    const fm = buildFrontmatter({
      id: noteId, type: 'project-dashboard', title, date: today,
      project: [projectName], topic: '', tags: ['dashboard', sectionKey],
      related: [], status: 'in-progress', created: iso, updated: iso,
    });
    const body = sec.template(projectName);
    const fullPath = await join(dataDir, FOLDERS.research, `${noteId}.md`);
    await invoke('ensure_dir', { path: await join(dataDir, FOLDERS.research) });
    await invoke('write_note', { path: fullPath, content: fm + body });
    reindexNote(fullPath, 'project-dashboard').catch(() => {});
    window.dispatchEvent(new CustomEvent('notes-changed'));
    openNote(fullPath);
  }, [dataDir, openNote]);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-ink-3 text-sm">
        <div className="w-4 h-4 border-2 border-chrome border-t-transparent rounded-full animate-spin mr-2" />
        로딩 중...
      </div>
    );
  }

  if (projects.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-ink-3 text-sm gap-2">
        <span className="text-3xl">🛰️</span>
        <p>등록된 프로젝트가 없습니다.</p>
        <p className="text-[10px]">사이드바 Projects 에서 프로젝트를 추가하세요.</p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="px-5 py-3 border-b border-border bg-paper-soft shrink-0">
        <h1 className="text-base font-semibold text-ink flex items-center gap-2">
          🛰️ Project Dashboard
        </h1>
      </div>

      <div className="px-5 pt-2 pb-0 border-b border-border bg-paper-soft shrink-0 flex gap-1 overflow-x-auto">
        {projects.map(p => (
          <button
            key={p.id}
            onClick={() => setActiveProjectId(p.id)}
            className={`px-3 py-1.5 text-xs font-medium rounded-t-md border border-b-0 transition-colors whitespace-nowrap ${
              activeProjectId === p.id
                ? 'bg-paper text-ink border-border'
                : 'bg-transparent text-ink-3 border-transparent hover:text-ink-2 hover:bg-paper-muted/30'
            }`}
          >
            <span
              className="inline-block w-2 h-2 rounded-full mr-1.5 align-middle"
              style={{ backgroundColor: p.color || '#6366f1' }}
            />
            {p.name}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
        {activeProject && SECTIONS.map(sec => {
          const note = findNote(sec.key);
          const content = note ? noteContents[note.path] ?? '' : '';
          const html = content ? mdToHtml(content) : '';
          return (
            <div key={sec.key} className="border border-border rounded-lg overflow-hidden">
              <div className="px-4 py-2 bg-paper-soft border-b border-border flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm font-medium text-ink">
                  <span>{sec.icon}</span>
                  <span>{sec.label}</span>
                </div>
                {note ? (
                  <button
                    onClick={() => openNote(note.path)}
                    className="text-[10px] text-ink-3 hover:text-chrome transition-colors"
                  >
                    편집 →
                  </button>
                ) : (
                  <button
                    onClick={() => handleCreate(activeProject.name, sec.key)}
                    className="text-[10px] text-chrome hover:text-chrome/80 transition-colors"
                  >
                    + 생성
                  </button>
                )}
              </div>
              <div className="px-4 py-3">
                {note && html ? (
                  <div className="dashboard-content" dangerouslySetInnerHTML={{ __html: html }} />
                ) : (
                  <div className="text-xs text-ink-3 italic">아직 작성된 내용이 없습니다.</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function hwSpecTemplate(projectName: string): string {
  return [
    '', `## ${projectName} 하드웨어 사양`, '',
    '| 항목 | 사양 | 비고 |', '|------|------|------|',
    '| 위성 크기 |  |  |', '| 위성 질량 |  |  |',
    '| 전력 |  |  |', '| 통신 |  |  |',
    '', '## OBC', '', '- ', '', '## 하네스 / 인터페이스', '', '- ', '',
  ].join('\n');
}

function orbitTemplate(projectName: string): string {
  return [
    '', `## ${projectName} 궤도 파라미터`, '',
    '| 파라미터 | 값 | 단위 |', '|----------|-----|------|',
    '| 궤도 종류 |  |  |', '| 고도 |  | km |',
    '| 경사각 |  | deg |', '| 주기 |  | min |',
    '| LTAN |  |  |', '| 이심률 |  |  |',
    '', '## TLE / 초기 궤도 요소', '', '```', '', '```', '',
  ].join('\n');
}

function attitudeTemplate(projectName: string): string {
  return [
    '', `## ${projectName} 자세 모드`, '',
    '### Safe Mode', '', '- 조건: ', '- 자세 제어: ', '- 센서: ', '',
    '### Detumbling Mode', '', '- 조건: ', '- 자세 제어: ', '',
    '### Normal Mode', '', '- 조건: ', '- 자세 제어: ', '- 정밀도: ', '',
    '### Fine Pointing Mode', '', '- 조건: ', '- 자세 제어: ', '- 정밀도: ', '',
  ].join('\n');
}

function overviewTemplate(projectName: string): string {
  return [
    '', `## ${projectName} 프로젝트 개요`, '',
    '| 항목 | 내용 |', '|------|------|',
    '| 프로젝트명 | ' + projectName + ' |',
    '| 상태 |  |', '| 시작일 |  |', '| 목표 완료일 |  |', '| PM |  |',
    '', '## 미션 목적', '', '- ', '', '## 핵심 요구사항', '', '- ',
    '', '## 일정', '', '| 마일스톤 | 날짜 | 상태 |', '|----------|------|------|',
    '|  |  |  |', '',
  ].join('\n');
}
