/** 태그 이름 → 결정적 "랜덤" 색상.
 *  같은 태그는 어디서든 항상 같은 색 — 이름 해시로 색상환(hue)을 고른다.
 *  라이트/다크 테마 모두에서 읽히도록 채도·명도는 고정, 배경은 반투명. */

function nameHash(name: string): number {
  let h = 0;
  for (const ch of name) h = (h * 31 + (ch.codePointAt(0) ?? 0)) >>> 0;
  return h;
}

export function tagHue(name: string): number {
  return nameHash(name) % 360;
}

/** 칩 배경색 — 반투명이라 테마 배경과 자연스럽게 섞인다 */
export function tagBg(name: string): string {
  return `hsl(${tagHue(name)} 65% 72% / 0.4)`;
}

/** 진한 포인트가 필요할 때 (점, 테두리 등) */
export function tagAccent(name: string): string {
  return `hsl(${tagHue(name)} 55% 55%)`;
}
