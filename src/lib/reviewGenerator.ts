import { writeNote } from './fileSystem';
import { FOLDERS } from './constants';
import { buildFrontmatter } from './frontmatter';
import { collectReviewData, buildReviewId, type ReviewType, type ReviewContext } from './reviewCollector';

const SYSTEM_PROMPT_BASE = `너는 GNC 엔지니어의 업무 리뷰를 분석하는 어시스턴트야.
사용자는 초소형 위성(6U~16U) ADCS/Orbit 담당.
한국어로 작성해. 마크다운 형식으로 작성해.`;

const WEEKLY_INSTRUCTIONS = `아래 주간 데이터를 분석해서 리뷰 작성:

## 주간 요약 (프로젝트별 3-5줄)
## 핵심 인사이트 (기술적 발견/판단 3개)
## 기술 성장 스냅샷
  - 활발한 태그 Top 5
  - 새 태그 + 맥락
  - Study Note 요약
  - 학습→적용 연결 하이라이트
## TODO 현황
  - 완료/신규/overdue 목록
  - 3일+ 이월 항목 → 원인 분석
## 열린 후속 과제 (우선순위 제안)
## 기록 품질 (orphan, 빈 결론, 태그 부족)
## 다음 주 제안 (우선 업무 3개 + 학습 적용 기회 + 마감 경고)`;

const MONTHLY_INSTRUCTIONS = `아래 월간 데이터를 분석해서 리뷰 작성:

## 월간 요약
## 생산성 통계 (workhour, 노트, 완료율, 시험통과율, 주차별 추이)
## 기술 성장 분석
  - 태그 심화도 변화
  - 학습→적용 전환율
  - 전문 영역 Top 3
## 의사결정 품질
  - Design Note 요약
  - 결정→검증 비율
## 업무 효율
  - 이월률 추이
  - TODO 마감 준수율
## 커리어 성장 제안 (성장 영역 + 다음 달 학습 추천 + 기록 습관 피드백)`;

const QUARTERLY_INSTRUCTIONS = `아래 분기 데이터를 분석해서 리뷰 작성:

## 분기 요약 + 주요 성과
## 종합 성장 점수 (생산성/기술성장/엔지니어링/지식관리 4축)
## 기술 포트폴리오
  - 기술 영역 맵
  - ADCS vs Orbit 비중
  - 학습→프로젝트 적용 하이라이트
## 프로젝트 기여도
## 업무 패턴 (시간 분배, 분석vs시험 비율)
## 병목 & 개선점
## 장기 역량 로드맵 (강점, 보완 영역, 다음 분기 목표 3-5개)`;

function getInstructions(type: ReviewType): string {
  if (type === 'weekly') return WEEKLY_INSTRUCTIONS;
  if (type === 'monthly') return MONTHLY_INSTRUCTIONS;
  return QUARTERLY_INSTRUCTIONS;
}

function buildUserMessage(ctx: ReviewContext): string {
  const parts: string[] = [];

  parts.push(`## 기간: ${ctx.periodStart} ~ ${ctx.periodEnd}`);
  parts.push(`\n## 통계\n\`\`\`json\n${JSON.stringify(ctx.stats, null, 2)}\n\`\`\``);

  if (ctx.dailyLogSummaries.length > 0) {
    parts.push(`\n## Daily Logs\n${ctx.dailyLogSummaries.join('\n\n')}`);
  }

  if (ctx.noteSummaries.length > 0) {
    parts.push(`\n## 노트 목록\n${ctx.noteSummaries.join('\n')}`);
  }

  if (ctx.todoSummary) {
    parts.push(`\n## 미완료 TODO\n${ctx.todoSummary}`);
  }

  return parts.join('\n');
}

export interface ReviewPromptResult {
  fullPrompt: string;
  meta: {
    reviewId: string;
    type: ReviewType;
    periodStart: string;
    periodEnd: string;
    stats: string;
  };
}

export async function generateReviewPrompt(
  dataDir: string,
  type: ReviewType,
  referenceDate?: Date,
  currentPeriod?: boolean,
): Promise<ReviewPromptResult> {
  const ctx = await collectReviewData(dataDir, type, referenceDate, currentPeriod);
  const instructions = getInstructions(type);
  const userMessage = buildUserMessage(ctx);
  const systemPrompt = `${SYSTEM_PROMPT_BASE}\n\n${instructions}`;

  const fullPrompt = `${systemPrompt}\n\n---\n\n${userMessage}`;
  const reviewId = buildReviewId(type, ctx.periodStart);

  return {
    fullPrompt,
    meta: {
      reviewId,
      type,
      periodStart: ctx.periodStart,
      periodEnd: ctx.periodEnd,
      stats: JSON.stringify(ctx.stats),
    },
  };
}

export async function saveReviewFromResponse(
  dataDir: string,
  responseText: string,
  meta: ReviewPromptResult['meta'],
): Promise<string> {
  const now = new Date().toISOString();
  const typeLabel = meta.type.charAt(0).toUpperCase() + meta.type.slice(1);

  const fm = buildFrontmatter({
    id: meta.reviewId,
    type: 'review',
    review_type: meta.type,
    title: `${typeLabel} Review ${meta.periodStart} ~ ${meta.periodEnd}`,
    period_start: meta.periodStart,
    period_end: meta.periodEnd,
    generated: now,
    model: 'claude.ai (manual)',
    status: 'complete',
    stats: meta.stats,
    created: now,
    updated: now,
  });

  const content = fm + responseText;
  const folder = meta.type === 'weekly' ? FOLDERS.reviewsWeekly : meta.type === 'monthly' ? FOLDERS.reviewsMonthly : FOLDERS.reviewsQuarterly;
  const filePath = `${folder}/${meta.reviewId}.md`;

  await writeNote(dataDir, filePath, content);
  return filePath;
}
