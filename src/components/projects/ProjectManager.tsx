import { useState, useEffect, useCallback } from 'react';
import { useProjectStore } from '../../stores/useProjectStore';
import { useAppStore } from '../../stores/useAppStore';
import { readJsonFile, writeJsonFile } from '../../lib/fileSystem';
import { FILES } from '../../lib/constants';
import type { Project, ProjectsFile } from '../../types/project';

const PRESET_COLORS = [
  '#FFB3BA', '#FFDFBA', '#FFFFBA', '#BAFFC9', '#BAE1FF',
  '#E8BAFF', '#FFC8DD', '#BDE0FE', '#A2D2FF', '#CDB4DB',
];

function generateId() {
  return Math.random().toString(36).substring(2, 10);
}

export function ProjectManager({ adding, setAdding, hidden }: { adding: boolean; setAdding: (v: boolean) => void; hidden?: boolean }) {
  const { dataDir } = useAppStore();
  const { projects, setProjects, addProject, removeProject, updateProject } = useProjectStore();
  const [newName, setNewName] = useState('');
  const [selectedColor, setSelectedColor] = useState(PRESET_COLORS[0]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editColor, setEditColor] = useState('');

  const loadProjects = useCallback(() => {
    if (!dataDir) return;
    readJsonFile<ProjectsFile>(dataDir, FILES.projects).then((data) => {
      if (data?.projects) setProjects(data.projects);
    });
  }, [dataDir, setProjects]);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  useEffect(() => {
    const handler = () => loadProjects();
    window.addEventListener('projects-changed', handler);
    return () => window.removeEventListener('projects-changed', handler);
  }, [loadProjects]);

  const persist = useCallback(
    (updated: Project[]) => {
      if (!dataDir) return;
      writeJsonFile(dataDir, FILES.projects, {
        version: 1,
        projects: updated,
      }).catch(() => {});
    },
    [dataDir],
  );

  function handleAdd() {
    const name = newName.trim();
    if (!name) return;
    const project: Project = {
      id: generateId(),
      name,
      color: selectedColor,
      createdAt: new Date().toISOString(),
    };
    addProject(project);
    persist([...projects, project]);
    setNewName('');
    setSelectedColor(PRESET_COLORS[0]);
    setAdding(false);
  }

  function startEdit(p: Project) {
    setEditingId(p.id);
    setEditName(p.name);
    setEditColor(p.color);
  }

  function commitEdit() {
    if (!editingId) return;
    const name = editName.trim();
    if (!name) {
      setEditingId(null);
      return;
    }
    updateProject(editingId, { name, color: editColor });
    persist(projects.map(p => p.id === editingId ? { ...p, name, color: editColor } : p));
    setEditingId(null);
  }

  function handleDelete(id: string, name: string) {
    if (!confirm(`"${name}" 프로젝트를 삭제하시겠습니까?`)) return;
    removeProject(id);
    persist(projects.filter((p) => p.id !== id));
    if (editingId === id) setEditingId(null);
  }

  if (hidden) return null;

  return (
    <div className="px-2">
      {adding && (
        <div className="mb-2 space-y-1.5">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); if (e.key === 'Escape') setAdding(false); }}
            placeholder="Project name..."
            autoFocus
            className="w-full px-2 py-1 text-xs rounded border border-border bg-paper-soft text-ink placeholder:text-ink-3 focus:outline-none focus:border-chrome"
          />
          <div className="flex gap-1 flex-wrap">
            {PRESET_COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setSelectedColor(c)}
                className="w-4 h-4 rounded-full border-2 transition-all"
                style={{
                  backgroundColor: c,
                  borderColor: selectedColor === c ? '#666' : 'transparent',
                }}
              />
            ))}
          </div>
          <div className="flex gap-1">
            <button
              onClick={handleAdd}
              className="px-2 py-0.5 text-[10px] rounded bg-chrome/30 text-ink font-medium hover:bg-chrome/50 transition-colors"
            >
              Add
            </button>
            <button
              onClick={() => setAdding(false)}
              className="px-2 py-0.5 text-[10px] rounded text-ink-3 hover:bg-paper-muted/50 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {editingId && (
        <div className="mb-2 space-y-1.5 p-1.5 rounded border border-chrome/30 bg-paper-soft">
          <input
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') setEditingId(null); }}
            autoFocus
            className="w-full px-2 py-1 text-xs rounded border border-border bg-paper text-ink focus:outline-none focus:border-chrome"
          />
          <div className="flex gap-1 flex-wrap">
            {PRESET_COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setEditColor(c)}
                className="w-4 h-4 rounded-full border-2 transition-all"
                style={{
                  backgroundColor: c,
                  borderColor: editColor === c ? '#666' : 'transparent',
                }}
              />
            ))}
          </div>
          <div className="flex gap-1">
            <button
              onClick={commitEdit}
              className="px-2 py-0.5 text-[10px] rounded bg-chrome/30 text-ink font-medium hover:bg-chrome/50 transition-colors"
            >
              Save
            </button>
            <button
              onClick={() => handleDelete(editingId, editName)}
              className="px-2 py-0.5 text-[10px] rounded text-red-500 hover:bg-red-500/10 transition-colors"
            >
              Delete
            </button>
            <button
              onClick={() => setEditingId(null)}
              className="px-2 py-0.5 text-[10px] rounded text-ink-3 hover:bg-paper-muted/50 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-1">
        {projects.map((p) => (
          <button
            key={p.id}
            onClick={() => startEdit(p)}
            title={`Click to edit "${p.name}"`}
            className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] rounded-full text-tag-text hover:opacity-70 transition-opacity"
            style={{ backgroundColor: p.color + '30' }}
          >
            <span
              className="w-1.5 h-1.5 rounded-full shrink-0"
              style={{ backgroundColor: p.color }}
            />
            {p.name}
          </button>
        ))}
        {projects.length === 0 && !adding && (
          <span className="text-[10px] text-ink-3">No projects</span>
        )}
      </div>
    </div>
  );
}
