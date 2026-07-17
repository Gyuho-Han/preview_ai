// 수기 분류(상/중/하) 선택기 — 표·상세 공용.
// 닫힘(collapsed) 상태에선 컨트롤 하나만 조용히 보이고, 클릭하면 옆으로 [상][중][하]가
// 펼쳐진다(드롭다운 세로 리스트 아님 — 가로 팝오버). 표의 100개 행에 버튼을 늘 펼쳐두지
// 않아 시선이 분산되지 않는다.
//   1) value 있음        → 꽉 찬 배지(확정)
//   2) suggestion 있음   → 점선 "AI 상" 칩(20개 학습 후 자동 제안, 미확정)
//   3) 둘 다 없음        → 빈 상태: 점선 원형 + '＋'
// 팝오버는 기존 FilterPill과 같은 tt-backdrop(전체화면 클릭 캐처)로 외부 클릭 시 닫는다.
import { useState } from "react";
import type { TierLabel } from "../types";
import { TIERS, tierText, tierClass } from "../util";

export default function TierPicker({
  value, suggestion, hint, onPick,
}: {
  value?: TierLabel;
  suggestion?: TierLabel;
  hint?: string;
  onPick: (label: TierLabel | null) => void;
}) {
  const [open, setOpen] = useState(false);

  function pick(t: TierLabel | null) {
    setOpen(false);
    onPick(t);
  }

  // 닫힘 컨트롤 — 상태별 한 개
  const collapsed = value ? (
    <button
      className={`tier-badge solid t-${tierClass(value)}`}
      onClick={() => setOpen((v) => !v)}
      title="내가 분류함 — 클릭해 변경/해제"
    >
      {tierText(value)}
    </button>
  ) : suggestion ? (
    <button
      className={`tier-badge ai t-${tierClass(suggestion)}`}
      onClick={() => setOpen((v) => !v)}
      title="AI 제안 — 클릭해 확정하거나 바꾸기"
    >
      AI {tierText(suggestion)}
    </button>
  ) : (
    <button className="tier-badge empty" onClick={() => setOpen((v) => !v)} title="분류하기">
      ＋
    </button>
  );

  return (
    <span className="tier-cell" title={hint}>
      {collapsed}
      {open && (
        <>
          <div className="tt-backdrop" onClick={() => setOpen(false)} />
          <div className="tier-pop" role="listbox">
            {TIERS.map((t) => {
              const active = value === t || (!value && suggestion === t);
              return (
                <button
                  key={t}
                  className={`tier-pop-opt t-${tierClass(t)} ${active ? "active" : ""}`}
                  onClick={() => pick(t)}
                >
                  {tierText(t)}
                </button>
              );
            })}
            {value && (
              <button className="tier-pop-clear" onClick={() => pick(null)} title="분류 해제">
                해제
              </button>
            )}
          </div>
        </>
      )}
    </span>
  );
}
