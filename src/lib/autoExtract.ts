import type { TagsFile } from '../types/dataFiles';

const SUBSYSTEM_KEYWORDS: Record<string, string[]> = {
  ADCS: ['반응 휠', 'RW', '자세제어', 'attitude', 'ADCS', 'reaction wheel', 'magnetorquer', 'star tracker', 'gyro', '자이로'],
  Orbit: ['궤도', 'orbit', 'TLE', 'SGP4', 'J2', 'propagat', 'ephemeris', 'ECEF', 'ECI'],
  EPS: ['전력', '배터리', 'solar panel', 'EPS', 'power', 'battery', 'solar cell'],
  COM: ['통신', 'communication', 'COM', 'antenna', 'downlink', 'uplink', 'RF'],
  OBC: ['OBC', 'onboard computer', 'flight software', 'RTOS'],
  STR: ['구조', 'structure', 'FEM', '진동', 'vibration', 'thermal vac'],
  Thermal: ['열', 'thermal', '방열', 'heater', 'radiator'],
  Payload: ['페이로드', 'payload', '카메라', 'camera', 'imager'],
};

export function suggestSubsystems(body: string, currentSubsystems: string[]): string[] {
  const suggestions: string[] = [];
  const lowerBody = body.toLowerCase();

  for (const [subsystem, keywords] of Object.entries(SUBSYSTEM_KEYWORDS)) {
    if (currentSubsystems.includes(subsystem)) continue;
    for (const kw of keywords) {
      if (lowerBody.includes(kw.toLowerCase())) {
        suggestions.push(subsystem);
        break;
      }
    }
  }

  return suggestions;
}

export function suggestTags(body: string, currentTags: string[], tagsFile: TagsFile | null): string[] {
  if (!tagsFile?.keyword_map) return [];
  const suggestions: string[] = [];

  for (const [keyword, tagName] of Object.entries(tagsFile.keyword_map)) {
    if (currentTags.includes(tagName)) continue;
    if (suggestions.includes(tagName)) continue;
    if (body.includes(keyword)) {
      suggestions.push(tagName);
    }
  }

  return suggestions.slice(0, 5);
}
