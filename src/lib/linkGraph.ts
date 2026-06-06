import { FILES } from './constants';
import { readJsonFile, writeJsonFile } from './fileSystem';
import type { LinksFile } from '../types/dataFiles';

let cache: LinksFile | null = null;

export async function loadLinks(dataDir: string): Promise<LinksFile> {
  if (cache) return cache;
  const data = await readJsonFile<LinksFile>(dataDir, FILES.links);
  cache = data ?? {};
  return cache;
}

export function invalidateLinksCache() {
  cache = null;
}

export async function getBacklinks(dataDir: string, noteId: string): Promise<string[]> {
  const links = await loadLinks(dataDir);
  return links[noteId]?.backward ?? [];
}

export async function getForwardLinks(dataDir: string, noteId: string): Promise<string[]> {
  const links = await loadLinks(dataDir);
  return links[noteId]?.forward ?? [];
}

export async function updateNoteLinks(
  dataDir: string,
  noteId: string,
  relatedIds: string[],
): Promise<void> {
  if (!noteId) return;
  const links = await loadLinks(dataDir);

  const oldForward = links[noteId]?.forward ?? [];
  const removedForward = oldForward.filter(id => !relatedIds.includes(id));
  for (const id of removedForward) {
    if (links[id]) {
      links[id].backward = links[id].backward.filter(b => b !== noteId);
      if (links[id].forward.length === 0 && links[id].backward.length === 0) {
        delete links[id];
      }
    }
  }

  if (!links[noteId]) links[noteId] = { forward: [], backward: [] };
  links[noteId].forward = relatedIds;

  for (const id of relatedIds) {
    if (!links[id]) links[id] = { forward: [], backward: [] };
    if (!links[id].backward.includes(noteId)) {
      links[id].backward.push(noteId);
    }
  }

  if (links[noteId].forward.length === 0 && links[noteId].backward.length === 0) {
    delete links[noteId];
  }

  cache = links;
  await writeJsonFile(dataDir, FILES.links, links);
  window.dispatchEvent(new CustomEvent('links-changed'));
}

export async function removeNoteLinks(dataDir: string, noteId: string): Promise<void> {
  if (!noteId) return;
  const links = await loadLinks(dataDir);

  const forward = links[noteId]?.forward ?? [];
  for (const id of forward) {
    if (links[id]) {
      links[id].backward = links[id].backward.filter(b => b !== noteId);
      if (links[id].forward.length === 0 && links[id].backward.length === 0) {
        delete links[id];
      }
    }
  }

  const backward = links[noteId]?.backward ?? [];
  for (const id of backward) {
    if (links[id]) {
      links[id].forward = links[id].forward.filter(f => f !== noteId);
      if (links[id].forward.length === 0 && links[id].backward.length === 0) {
        delete links[id];
      }
    }
  }

  delete links[noteId];
  cache = links;
  await writeJsonFile(dataDir, FILES.links, links);
  window.dispatchEvent(new CustomEvent('links-changed'));
}
