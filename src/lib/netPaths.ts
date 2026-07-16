/** 네트워크 공유 링크의 OS별 열기 대상 변환.
 *
 *  macOS는 `open smb://...`를 네이티브로 처리하지만 (Finder가 마운트),
 *  Windows는 smb:// 스킴을 열지 못하므로 UNC 경로(\\host\share\...)로
 *  변환해서 탐색기에 넘긴다. Bonjour 서비스 이름(host._smb._tcp.local)은
 *  Windows에서 호스트명으로 해석되지 않으므로 순수 호스트명만 남긴다. */
export function smbToOpenTarget(href: string): string {
  if (!href.startsWith('smb://')) return href;
  const isWindows = navigator.platform.startsWith('Win');
  if (!isWindows) return href;
  let rest = href.slice('smb://'.length);
  try {
    rest = decodeURI(rest);
  } catch { /* 인코딩 안 된 경로 그대로 사용 */ }
  const [host, ...parts] = rest.split('/');
  const cleanHost = host.replace(/\._smb\._tcp\.local$/i, '');
  return `\\\\${cleanHost}${parts.length ? '\\' + parts.join('\\') : ''}`;
}
