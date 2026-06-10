import { useState, useEffect, useCallback } from 'react';

interface Step {
  title: string;
  body: string;
  icon: string;
}

const steps: Step[] = [
  {
    title: 'JRH-Orbit에 오신 것을 환영합니다!',
    body: '위성 엔지니어를 위한 업무 노트 앱입니다. 주요 기능을 빠르게 둘러볼게요.',
    icon: '🛰️',
  },
  {
    title: 'Daily Log',
    body: '매일의 작업, 메모, 생성한 노트, 내일 할 일을 기록합니다. TODO가 자동으로 이월되고, 체크하면 Tasks와 동기화됩니다.',
    icon: '📅',
  },
  {
    title: 'Research Notes',
    body: '분석 노트, 테스트 로그, 설계 노트, 스터디 노트, 퀵 메모 — 5가지 유형의 노트를 작성할 수 있습니다. YAML 프론트매터로 메타데이터를 관리합니다.',
    icon: '📝',
  },
  {
    title: 'Tasks',
    body: 'TODO 관리: 우선순위, 프로젝트 분류, 반복 TODO, 기한 추적. Daily Log와 양방향으로 동기화됩니다.',
    icon: '✅',
  },
  {
    title: 'Wiki-Links & Graph',
    body: '[[노트 제목]]으로 노트 간 링크를 걸 수 있습니다. Graph 뷰에서 노트 연결 관계를 시각적으로 확인하세요.',
    icon: '🔗',
  },
  {
    title: '생산성 도구',
    body: '뽀모도로 타이머, YouTube 음악 플레이어, D-Day 카운터, AI 주간 리뷰 자동 생성 — 모두 하단 상태바에서 접근할 수 있습니다.',
    icon: '⏱️',
  },
  {
    title: '키보드 단축키',
    body: 'Cmd+1~7로 뷰 전환, Cmd+K 검색, Cmd+N 노트, Cmd+Shift+N 퀵 메모. Settings에서 전체 단축키를 확인하세요.',
    icon: '⌨️',
  },
  {
    title: '테마',
    body: '10가지 테마를 지원합니다: Light, Dark, Paper, Spreadsheet, VA-11 Hall-A, Terminal, 버디버디, Solarized, Forest, Ocean. Settings에서 변경하세요.',
    icon: '🎨',
  },
];

const ONBOARDING_KEY = 'jrh-orbit-onboarding-complete';

export function OnboardingTour() {
  const [visible, setVisible] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    const done = localStorage.getItem(ONBOARDING_KEY);
    if (!done) setVisible(true);
  }, []);

  const close = useCallback(() => {
    localStorage.setItem(ONBOARDING_KEY, 'true');
    setVisible(false);
  }, []);

  if (!visible) return null;

  const current = steps[step];
  const isLast = step === steps.length - 1;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-paper border border-border rounded-xl shadow-2xl max-w-md w-full mx-4 overflow-hidden">
        <div className="px-6 pt-6 pb-4">
          <div className="flex items-center gap-3 mb-3">
            <span className="text-3xl">{current.icon}</span>
            <h2 className="text-lg font-semibold text-ink">{current.title}</h2>
          </div>
          <p className="text-sm text-ink-2 leading-relaxed">{current.body}</p>
        </div>

        <div className="px-6 pb-2">
          <div className="flex gap-1">
            {steps.map((_, i) => (
              <div
                key={i}
                className={`h-1 flex-1 rounded-full transition-colors ${
                  i <= step ? 'bg-chrome' : 'bg-border'
                }`}
              />
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between px-6 py-4">
          <button
            onClick={close}
            className="text-xs text-ink-3 hover:text-ink-2 transition-colors"
          >
            건너뛰기
          </button>
          <div className="flex gap-2">
            {step > 0 && (
              <button
                onClick={() => setStep(step - 1)}
                className="px-3 py-1.5 text-sm rounded-lg border border-border text-ink-2 hover:bg-paper-soft transition-colors"
              >
                이전
              </button>
            )}
            <button
              onClick={() => (isLast ? close() : setStep(step + 1))}
              className="px-4 py-1.5 text-sm rounded-lg bg-chrome/30 text-ink font-medium hover:bg-chrome/50 transition-colors"
            >
              {isLast ? '시작하기' : '다음'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function resetOnboarding() {
  localStorage.removeItem(ONBOARDING_KEY);
}
