import { convertFileSrc } from '@tauri-apps/api/core';

/**
 * 첨부파일 경로 이식성 레이어.
 *
 * 저장 형태(파일에 쓰이는 마크다운): `attachments/<하위경로>` 상대 경로.
 *   → 어느 OS/기기에서 열어도 dataDir 기준으로 해석 가능하고,
 *     GitHub·VS Code 등 외부 뷰어에서도 이미지가 보인다.
 * 표시 형태(에디터가 들고 있는 마크다운):
 *   이미지 → convertFileSrc(절대경로) asset URL.
 *   파일 링크 → 상대 경로 그대로 둔다. markdown-it이 보안상 `file:` 링크를
 *   거부해 원문 텍스트로 노출되므로 file:// 변환 금지 — 클릭 시점에
 *   dataDir로 해석해서 open_path로 연다 (NoteEditor/DashboardView).
 *
 * 과거 노트에 박힌 기기 종속 절대 URL(`http://asset.localhost/G%3A%5C...`,
 * `asset://localhost/...`, `file://G:/...`)도 attachments/ 이하만 추출해
 * 재해석한다(이미지=asset URL, 링크=상대 경로) — 파일을 고치지 않아도 표시가
 * 되고, 사용자가 그 노트를 편집하면 저장 시 상대 경로로 자연 이행된다.
 */

const ASSET_URL_RE = /(?:asset:\/\/localhost|https?:\/\/asset\.localhost)\/[^\s"'<>)\]]+/g;
const FILE_URL_RE = /file:\/\/[^\s"'<>)\]]+/g;

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    try {
      return decodeURI(s);
    } catch {
      return s;
    }
  }
}

/** 디코드된 경로에서 attachments/ 이하 상대 경로를 추출 (없으면 null) */
function attachmentsRest(decodedPath: string): string | null {
  const norm = decodedPath.replace(/\\/g, '/');
  const m = norm.match(/(?:^|\/)attachments\/(.+)$/);
  return m ? m[1] : null;
}

/** 마크다운 링크 괄호·공백을 깨뜨리지 않도록 상대 경로를 인코딩 */
function encodeRel(rel: string): string {
  return encodeURI(rel).replace(/\(/g, '%28').replace(/\)/g, '%29');
}

function stripAssetPrefix(url: string): string {
  return url.replace(/^(?:asset:\/\/localhost|https?:\/\/asset\.localhost)\//, '');
}

/** 에디터가 내놓은 마크다운의 asset/file URL을 상대 경로 저장 형태로 변환 */
export function attachmentsToStorage(md: string): string {
  return md
    .replace(ASSET_URL_RE, (url) => {
      const rest = attachmentsRest(safeDecode(stripAssetPrefix(url)));
      return rest ? `attachments/${encodeRel(rest)}` : url;
    })
    .replace(FILE_URL_RE, (url) => {
      const rest = attachmentsRest(safeDecode(url.slice('file://'.length)));
      return rest ? `attachments/${encodeRel(rest)}` : url;
    });
}

/** 파일에서 읽은 마크다운을 현재 기기에서 렌더링 가능한 표시 형태로 변환.
 *  이미지만 asset URL로 바꾸고, 파일 링크는 상대 경로를 유지한다. */
export function attachmentsToDisplay(md: string, dataDir: string): string {
  if (!dataDir) return md;
  const base = dataDir.replace(/[\\/]+$/, '');
  const asImg = (rel: string) => convertFileSrc(`${base}/attachments/${safeDecode(rel)}`);

  // 레거시 절대 URL 재해석: asset 계열(이미지)은 현재 dataDir 기준 asset URL로,
  // file:// 링크는 상대 경로로 (markdown-it이 file:을 거부하므로)
  let out = md.replace(ASSET_URL_RE, (url) => {
    const rest = attachmentsRest(safeDecode(stripAssetPrefix(url)));
    return rest ? asImg(rest) : url;
  });
  out = out.replace(FILE_URL_RE, (url) => {
    const rest = attachmentsRest(safeDecode(url.slice('file://'.length)));
    return rest ? `attachments/${encodeRel(rest)}` : url;
  });

  // 상대 경로 이미지(`![]()`, src=)만 asset URL로 — 링크는 그대로
  out = out.replace(
    /(!)(\[(?:\\.|[^\]\\])*\]\()attachments\/([^)\s]+)(\))/g,
    (_m, bang, open, rel, close) => `${bang}${open}${asImg(rel)}${close}`,
  );
  out = out.replace(/src="attachments\/([^"]+)"/g, (_m, rel) => `src="${asImg(rel)}"`);
  return out;
}

/** attachments 상대 경로를 마크다운 링크에 안전한 href로 인코딩 */
export function encodeAttachmentHref(relPath: string): string {
  return encodeRel(relPath.replace(/\\/g, '/'));
}

/** 상대 attachments href를 실제 파일 절대 경로로 해석 (클릭해서 열 때) */
export function resolveAttachmentHref(href: string, dataDir: string): string | null {
  if (!dataDir || !href.startsWith('attachments/')) return null;
  return `${dataDir.replace(/[\\/]+$/, '')}/${safeDecode(href)}`;
}

/** 첨부 저장용 하위 폴더명(노트 stem/날짜)을 파일시스템 안전하게 정리 */
export function sanitizeAttachmentSubdir(subdir: string): string {
  return subdir.replace(/[\\/:*?"<>|]+/g, '-').replace(/^\.+/, '').trim();
}
