import { invoke } from '@tauri-apps/api/core';
import { join } from '@tauri-apps/api/path';
import { readJsonFile } from './fileSystem';
import { FILES, FOLDERS } from './constants';
import { splitFrontmatter, parseFrontmatterFields } from './frontmatter';
import { normalizeLegacyType, normalizeProject, type NoteType } from '../types/note';
import type { LinksFile } from '../types/dataFiles';
import type { TodosFile } from '../types/task';

export interface GraphNode {
  id: string;
  title: string;
  type: NoteType | 'orphan';
  project: string[];
  path: string;
  x: number;
  y: number;
  linkCount: number;
}

export interface GraphEdge {
  source: string;
  target: string;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

async function discoverNotes(
  dataDir: string,
): Promise<Map<string, { title: string; type: NoteType; project: string[]; path: string }>> {
  const map = new Map<string, { title: string; type: NoteType; project: string[]; path: string }>();

  for (const folder of [FOLDERS.daily, FOLDERS.research]) {
    try {
      const dir = await join(dataDir, folder);
      const files = await invoke<string[]>('list_notes', { dir });
      for (const fullPath of files) {
        try {
          const raw = await invoke<string>('read_note', { path: fullPath });
          const { frontmatter } = splitFrontmatter(raw);
          if (!frontmatter) continue;
          const fields = parseFrontmatterFields(frontmatter);
          const id = fields.id;
          if (!id) continue;
          map.set(id, {
            title: fields.title ?? id,
            type: normalizeLegacyType(fields.type ?? 'quick-memo') as NoteType,
            project: normalizeProject(fields.project),
            path: fullPath,
          });
        } catch {}
      }
    } catch {}
  }

  return map;
}

export async function buildGraphData(dataDir: string): Promise<GraphData> {
  const [links, noteMeta] = await Promise.all([
    readJsonFile<LinksFile>(dataDir, FILES.links),
    discoverNotes(dataDir),
  ]);

  const noteIds = new Set<string>();

  // Add all notes from filesystem
  for (const id of noteMeta.keys()) {
    noteIds.add(id);
  }

  // Only include link targets that exist on disk
  if (links) {
    for (const [id, entry] of Object.entries(links)) {
      if (noteMeta.has(id)) noteIds.add(id);
      for (const fwd of entry.forward) { if (noteMeta.has(fwd)) noteIds.add(fwd); }
      for (const bwd of entry.backward) { if (noteMeta.has(bwd)) noteIds.add(bwd); }
    }
  }

  // Compute link counts
  const linkCounts = new Map<string, number>();
  if (links) {
    for (const id of noteIds) {
      const entry = links[id];
      const fwdCount = entry?.forward?.length ?? 0;
      const bwdCount = entry?.backward?.length ?? 0;
      linkCounts.set(id, fwdCount + bwdCount);
    }
  }

  // Build nodes
  const nodeMap = new Map<string, GraphNode>();
  for (const id of noteIds) {
    const meta = noteMeta.get(id);
    const linkCount = linkCounts.get(id) ?? 0;
    nodeMap.set(id, {
      id,
      title: meta?.title ?? id,
      type: meta?.type ?? 'orphan',
      project: meta?.project ?? [],
      path: meta?.path ?? '',
      x: Math.random() * 800 - 400,
      y: Math.random() * 600 - 300,
      linkCount,
    });
  }

  // Build edges (deduplicated)
  const edgeSet = new Set<string>();
  const edges: GraphEdge[] = [];
  if (links) {
    for (const [id, entry] of Object.entries(links)) {
      for (const target of entry.forward) {
        const key = [id, target].sort().join('::');
        if (!edgeSet.has(key) && nodeMap.has(id) && nodeMap.has(target)) {
          edgeSet.add(key);
          edges.push({ source: id, target });
        }
      }
    }
  }

  // Add task nodes and task-note edges
  const todosFile = await readJsonFile<TodosFile>(dataDir, FILES.todos);
  if (todosFile?.todos) {
    for (const task of todosFile.todos) {
      if (!task.related_notes?.length) continue;
      const taskNodeId = `task:${task.id}`;
      if (!nodeMap.has(taskNodeId)) {
        nodeMap.set(taskNodeId, {
          id: taskNodeId,
          title: task.title,
          type: 'orphan' as NoteType | 'orphan',
          project: task.projectId ? [task.projectId] : [],
          path: '',
          x: Math.random() * 800 - 400,
          y: Math.random() * 600 - 300,
          linkCount: task.related_notes.length,
        });
      }
      for (const noteId of task.related_notes) {
        if (!nodeMap.has(noteId)) continue;
        const key = [taskNodeId, noteId].sort().join('::');
        if (!edgeSet.has(key)) {
          edgeSet.add(key);
          edges.push({ source: taskNodeId, target: noteId });
          const noteNode = nodeMap.get(noteId);
          if (noteNode) noteNode.linkCount++;
        }
      }
    }
  }

  return {
    nodes: Array.from(nodeMap.values()),
    edges,
  };
}
