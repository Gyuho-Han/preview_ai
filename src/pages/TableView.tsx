// P4 표 페이지 — 날짜 섹션 + 장소 연속 병합, 검색/기간/필터, 추천도, 실시간
import { useEffect, useMemo, useState, useCallback } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api";
import type { Clip } from "../types";
import {
  fmtTC, colorClass, scoreLabel, fmtDateLabel,
  personColor, cameraColor, initialOf,
} from "../util";
import { useLabels, toggleFavorite } from "../labels";
import ThumbScrub from "../components/ThumbScrub";

type ViewMode = "date" | "flat";

// 토스 스타일 필터 — pill 버튼 + 팝오버 단일 선택 리스트 (네이티브 select 대체)
// value가 "전체"에 해당하는 값(빈 문자열 등)이면 활성 표시를 하지 않는다.
function FilterPill<T extends string | number>({
  label, value, allValue, options, onChange,
}: {
  label: string; value: T; allValue: T;
  options: { value: T; text: string }[]; onChange: (v: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const isAll = value === allValue;
  const current = options.find((o) => o.value === value)?.text;
  return (
    <div className="tt-pillwrap">
      <button className={`tt-pill ${!isAll ? "on" : ""}`} onClick={() => setOpen((v) => !v)}>
        {isAll ? label : current}
        <svg viewBox="0 0 12 8" width="10" height="7" aria-hidden="true"><path d="M6 8 0 0h12z" fill="currentColor" /></svg>
      </button>
      {open && (
        <>
          <div className="tt-backdrop" onClick={() => setOpen(false)} />
          <div className="tt-plist">
            <button className={isAll ? "on" : ""} onClick={() => { onChange(allValue); setOpen(false); }}>{label} 전체</button>
            {options.map((o) => (
              <button key={String(o.value)} className={value === o.value ? "on" : ""} onClick={() => { onChange(o.value); setOpen(false); }}>{o.text}</button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// 즐겨찾기 하트 — 전용 컬럼에 항상 노출(호버 불필요)
function Heart({ on, onClick }: { on: boolean; onClick: (e: React.MouseEvent) => void }) {
  return (
    <button className={`heart-col ${on ? "on" : ""}`} onClick={onClick} title={on ? "찜 해제" : "찜하기"}>
      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
        <path d="M12 20s-7-4.7-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.3-7 10-7 10z"
          fill={on ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

// 대상(Object) — 인물이면 아바타 클러스터 + 이름(한 번만), 아니면 사물·풍경 라벨
function Subject({ clip }: { clip: Clip }) {
  const people = clip.people ?? [];
  if (people.length > 0) {
    return (
      <div className="subject-cell" title={people.join(", ")}>
        <span className="av-cluster">
          {people.slice(0, 3).map((p) => {
            const { bg, fg } = personColor(p);
            return <span className="person-av" key={p} style={{ background: bg, color: fg }}>{initialOf(p)}</span>;
          })}
        </span>
        <span className="subject-name">{people.join(", ")}</span>
      </div>
    );
  }
  if (!clip.subject) return <span className="muted">—</span>;
  return (
    <span className="subject-cell obj" title={clip.subject}>
      <span className="subject-ic" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="13" height="13"><path d="M4 17l5-6 3.5 4 2.5-3 5 5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /><circle cx="8" cy="8" r="1.8" fill="currentColor" /></svg>
      </span>
      {clip.subject}
    </span>
  );
}

// 카메라 — 색 일관성 있는 칩
function Camera({ camera }: { camera?: string }) {
  if (!camera) return <span className="muted">—</span>;
  const { bg, fg } = cameraColor(camera);
  return (
    <span className="cam-chip" style={{ background: bg, color: fg, borderColor: `${fg}44` }}>
      <svg viewBox="0 0 24 24" width="11" height="11" aria-hidden="true">
        <path d="M4 8h3l1.2-1.8h5.6L15 8h5v10H4z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        <circle cx="12" cy="13" r="3.1" fill="none" stroke="currentColor" strokeWidth="1.8" />
      </svg>
      {camera}
    </span>
  );
}

// 추천도 셀 — 바 + 숫자
function Score({ clip }: { clip: Clip }) {
  const cc = colorClass(clip.color);
  return (
    <div className="score" title={scoreLabel(clip.color)}>
      <div className="score-bar">
        <div className={`bg-${cc}`} style={{ width: `${clip.recommendation ?? 0}%` }} />
      </div>
      <span className={`score-num c-${cc}`}>{clip.recommendation ?? 0}</span>
    </div>
  );
}

// 파일명 옆 경고 딱지
function Warn({ clip }: { clip: Clip }) {
  const w = clip.warnings ?? [];
  if (w.length === 0) return null;
  return (
    <span className="warn-chip" style={{ marginLeft: 8 }} title={w.join(", ")}>
      ⚠ {w.length > 1 ? w.length : ""}
    </span>
  );
}

const COLS = 8; // 썸네일·파일명·추천도·영상개요·대상·카메라·TC·즐겨찾기 (장소는 병합 셀로 별도)
const PAGE_SIZE = 60;

export default function TableView() {
  const { pid = "" } = useParams();
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const [clips, setClips] = useState<Clip[]>([]);

  const [q, setQ] = useState("");
  const [fPlace, setFPlace] = useState("");
  const [fCamera, setFCamera] = useState("");
  const [fMinScore, setFMinScore] = useState(Number(sp.get("min")) || 0);
  const [fFrom, setFFrom] = useState("");
  const [fTo, setFTo] = useState("");
  const [dateOpen, setDateOpen] = useState(false);
  const [favOnly, setFavOnly] = useState(false);
  const [view, setView] = useState<ViewMode>("date");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);

  const labels = useLabels(pid);
  const favSet = useMemo(() => new Set(labels.favorites), [labels.favorites]);

  const refresh = useCallback(() => {
    api.listClips(pid).then(setClips).catch(() => {});
  }, [pid]);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    const active = clips.some((c) => c.status === "queued");
    if (!active) return;
    const t = setInterval(refresh, 1500);
    return () => clearInterval(t);
  }, [clips, refresh]);

  const places = useMemo(() => [...new Set(clips.map((c) => c.place).filter((x): x is string => Boolean(x)))], [clips]);
  const cameras = useMemo(() => [...new Set(clips.map((c) => c.camera).filter((x): x is string => Boolean(x)))], [clips]);
  // 촬영 기간(달력 범위 min/max)
  const dateRange = useMemo(() => {
    const ds = clips.map((c) => c.date).filter(Boolean).sort() as string[];
    return { min: ds[0] || "", max: ds[ds.length - 1] || "" };
  }, [clips]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return clips
      .filter((c) => c.status === "done")
      .filter((c) => !fPlace || c.place === fPlace)
      .filter((c) => !fCamera || c.camera === fCamera)
      .filter((c) => (c.recommendation ?? 0) >= fMinScore)
      .filter((c) => !fFrom || (c.date ?? "") >= fFrom)
      .filter((c) => !fTo || (c.date ?? "") <= fTo)
      .filter((c) => !favOnly || favSet.has(c.id))
      .filter((c) => {
        if (!needle) return true;
        const hay = [
          c.filename, c.one_line, c.summary, c.place, c.camera,
          (c.keywords ?? []).join(" "), (c.people ?? []).join(" "),
        ].join(" ").toLowerCase();
        return hay.includes(needle);
      })
      .sort((a, b) => {
        const d = (a.date ?? "").localeCompare(b.date ?? "");
        return d !== 0 ? d : a.filename.localeCompare(b.filename);
      });
  }, [clips, q, fPlace, fCamera, fMinScore, fFrom, fTo, favOnly, favSet]);

  // 필터가 바뀌면 첫 페이지로
  useEffect(() => { setPage(1); }, [q, fPlace, fCamera, fMinScore, fFrom, fTo, favOnly, view]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageSafe = Math.min(page, totalPages);
  const pageItems = useMemo(
    () => filtered.slice((pageSafe - 1) * PAGE_SIZE, pageSafe * PAGE_SIZE),
    [filtered, pageSafe]
  );

  // 날짜별 그룹 (현재 페이지 기준 — 섹션 헤더 + 장소 병합용)
  const groups = useMemo(() => {
    const map = new Map<string, Clip[]>();
    for (const c of pageItems) {
      const key = c.date || "";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(c);
    }
    return [...map.entries()].map(([date, items]) => ({ date, items }));
  }, [pageItems]);

  const analyzing = clips.filter((c) => c.status === "queued").length;
  const hasFilter = q || fPlace || fCamera || fMinScore > 0 || fFrom || fTo || favOnly;

  function resetFilters() {
    setQ(""); setFPlace(""); setFCamera(""); setFMinScore(0); setFFrom(""); setFTo("");
    setFavOnly(false);
  }

  // 페이지 이동 시 표 상단으로 스크롤 복귀(맨 밑에서 눌러도 다음 페이지 헤더부터 보이게)
  function goPage(n: number) {
    setPage(n);
    document.querySelector(".content")?.scrollTo({ top: 0, behavior: "smooth" });
  }

  // 페이지 번호 목록 — 앞/뒤 2개 + 현재 주변, 나머지는 "…"로 축약
  const pageNums = useMemo(() => {
    if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
    const nums = new Set([1, 2, totalPages - 1, totalPages, pageSafe - 1, pageSafe, pageSafe + 1]);
    const sorted = [...nums].filter((n) => n >= 1 && n <= totalPages).sort((a, b) => a - b);
    const out: (number | "…")[] = [];
    sorted.forEach((n, i) => {
      if (i > 0 && n - (sorted[i - 1] as number) > 1) out.push("…");
      out.push(n);
    });
    return out;
  }, [totalPages, pageSafe]);

  function toggleDate(date: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(date) ? next.delete(date) : next.add(date);
      return next;
    });
  }

  // 장소 연속 병합: 각 인덱스가 run 시작인지 + run 길이
  function placeRuns(items: Clip[]) {
    const start: boolean[] = [];
    const len: number[] = [];
    let i = 0;
    while (i < items.length) {
      let j = i;
      while (j < items.length && (items[j].place || "") === (items[i].place || "")) j++;
      for (let k = i; k < j; k++) { start[k] = k === i; len[k] = k === i ? j - i : 0; }
      i = j;
    }
    return { start, len };
  }

  const favCell = (c: Clip) => (
    <td className="fav-td" onClick={(e) => e.stopPropagation()}>
      <Heart on={favSet.has(c.id)} onClick={(e) => { e.stopPropagation(); toggleFavorite(pid, c.id); }} />
    </td>
  );

  const rowFor = (c: Clip) => (
    <>
      <td onClick={(e) => e.stopPropagation()}><ThumbScrub clip={c} /></td>
      <td className="cell-file">{c.filename}</td>
      <td><Score clip={c} /></td>
      <td className="cell-summary">
        {c.one_line || "—"}
        <Warn clip={c} />
      </td>
      <td><Subject clip={c} /></td>
      <td><Camera camera={c.camera} /></td>
      <td className="muted cell-tc">{fmtTC(c.duration_sec)}</td>
      {favCell(c)}
    </>
  );

  return (
    <div>
      <div className="row spread page-head">
        <h1>표 <span className="muted" style={{ fontSize: 14, fontWeight: 400 }}>{filtered.length}개</span></h1>
        <div className="view-toggle">
          <button className={view === "date" ? "on" : ""} onClick={() => setView("date")}>날짜별</button>
          <button className={view === "flat" ? "on" : ""} onClick={() => setView("flat")}>전체</button>
        </div>
      </div>

      {analyzing > 0 && (
        <p className="muted"><span className="spinner" /> {analyzing}개 분석 중 — 완료되는 대로 표에 추가됩니다.</p>
      )}

      {/* 검색 + 기간 + 필터 툴바 */}
      <div className="table-toolbar">
        <div className="tt-search">
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" strokeWidth="1.8" />
            <path d="M20 20l-3.5-3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          <input
            placeholder="영상개요·키워드·인물·파일명 검색…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          {q && <button className="tt-clear" onClick={() => setQ("")} title="지우기">×</button>}
        </div>

        <div className="tt-datewrap">
          <button
            className={`tt-datebtn ${fFrom || fTo ? "on" : ""}`}
            onClick={() => setDateOpen((v) => !v)}
            title="촬영 기간"
          >
            <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
              <rect x="3.5" y="4.5" width="17" height="16" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.7" />
              <path d="M3.5 9h17M8 3v3M16 3v3" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
            </svg>
            {fFrom || fTo ? `${fFrom || "처음"} ~ ${fTo || "끝"}` : "기간"}
          </button>
          {dateOpen && (
            <>
              <div className="tt-backdrop" onClick={() => setDateOpen(false)} />
              <div className="tt-datepop">
                <label>시작<input type="date" value={fFrom} min={dateRange.min} max={fTo || dateRange.max} onChange={(e) => setFFrom(e.target.value)} /></label>
                <label>종료<input type="date" value={fTo} min={fFrom || dateRange.min} max={dateRange.max} onChange={(e) => setFTo(e.target.value)} /></label>
                <div className="tt-datepop-foot">
                  <button className="link-btn" onClick={() => { setFFrom(""); setFTo(""); }}>초기화</button>
                  <button className="secondary sm" onClick={() => setDateOpen(false)}>완료</button>
                </div>
              </div>
            </>
          )}
        </div>

        <FilterPill
          label="장소" value={fPlace} allValue=""
          options={places.map((p) => ({ value: p, text: p }))}
          onChange={setFPlace}
        />
        <FilterPill
          label="카메라" value={fCamera} allValue=""
          options={cameras.map((c) => ({ value: c, text: c }))}
          onChange={setFCamera}
        />
        <FilterPill
          label="추천도" value={fMinScore} allValue={0}
          options={[{ value: 50, text: "보통 이상" }, { value: 80, text: "추천" }]}
          onChange={setFMinScore}
        />

        <button className={`tt-fav ${favOnly ? "on" : ""}`} onClick={() => setFavOnly((v) => !v)} title="찜한 것만 보기">
          <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
            <path d="M12 20s-7-4.7-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.3-7 10-7 10z" fill={favOnly ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="empty-state">
          <div className="empty-art">🔍</div>
          <h3>표시할 클립이 없습니다</h3>
          <p>{clips.length === 0 ? "대시보드에서 영상을 추가하면 분석 결과가 여기에 정리됩니다." : "검색·필터 조건에 맞는 클립이 없습니다. 조건을 바꿔보세요."}</p>
        </div>
      ) : view === "date" ? (
        <table className="tbl">
          <thead>
            <tr>
              <th className="th-place">장소</th>
              <th>썸네일</th><th>파일명</th><th>추천도</th><th>영상개요</th>
              <th>대상</th><th>카메라</th><th>TC</th>
              <th className="th-fav">찜</th>
            </tr>
          </thead>
          {groups.map((g) => {
            const { md, wd } = fmtDateLabel(g.date);
            const isCollapsed = collapsed.has(g.date);
            const runs = placeRuns(g.items);
            return (
              <tbody key={g.date || "nodate"}>
                <tr className="date-row" onClick={() => toggleDate(g.date)}>
                  <td colSpan={COLS + 1}>
                    <span className={`date-caret ${isCollapsed ? "closed" : ""}`}>▾</span>
                    <span className="date-md">{md}</span>
                    {wd && <span className="date-wd">({wd})</span>}
                    <span className="date-count">{g.items.length}개</span>
                  </td>
                </tr>
                {!isCollapsed && g.items.map((c, i) => (
                  <tr key={c.id} className="clip-row" onClick={() => nav(`/project/${pid}/clip/${c.id}`)}>
                    {runs.start[i] && (
                      <td className="place-cell" rowSpan={runs.len[i]}>
                        <span className="place-pin">
                          <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">
                            <path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11z" fill="none" stroke="currentColor" strokeWidth="1.7" />
                            <circle cx="12" cy="10" r="2.4" fill="none" stroke="currentColor" strokeWidth="1.7" />
                          </svg>
                          {c.place || "—"}
                        </span>
                      </td>
                    )}
                    {rowFor(c)}
                  </tr>
                ))}
              </tbody>
            );
          })}
        </table>
      ) : (
        <table className="tbl">
          <thead>
            <tr>
              <th>썸네일</th><th>파일명</th><th>추천도</th><th>영상개요</th>
              <th>장소</th><th>대상</th><th>카메라</th><th>날짜</th><th>TC</th>
              <th className="th-fav">찜</th>
            </tr>
          </thead>
          <tbody>
            {pageItems.map((c) => (
              <tr key={c.id} className="clip-row" onClick={() => nav(`/project/${pid}/clip/${c.id}`)}>
                <td onClick={(e) => e.stopPropagation()}><ThumbScrub clip={c} /></td>
                <td className="cell-file">{c.filename}</td>
                <td><Score clip={c} /></td>
                <td className="cell-summary">{c.one_line || "—"}<Warn clip={c} /></td>
                <td>{c.place || "—"}</td>
                <td><Subject clip={c} /></td>
                <td><Camera camera={c.camera} /></td>
                <td className="muted">{fmtDateLabel(c.date).md}</td>
                <td className="muted cell-tc">{fmtTC(c.duration_sec)}</td>
                {favCell(c)}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {totalPages > 1 && (
        <div className="pagination">
          <button className="secondary sm" disabled={pageSafe <= 1} onClick={() => goPage(pageSafe - 1)}>← 이전</button>
          <span className="pg-range">
            {(pageSafe - 1) * PAGE_SIZE + 1}–{Math.min(pageSafe * PAGE_SIZE, filtered.length)}
            <span className="muted"> / {filtered.length}개</span>
          </span>
          <div className="pg-nums">
            {pageNums.map((n, i) =>
              n === "…" ? (
                <span key={`e${i}`} className="pg-ellipsis">…</span>
              ) : (
                <button key={n} className={`pg-num ${n === pageSafe ? "on" : ""}`} onClick={() => goPage(n as number)}>{n}</button>
              )
            )}
          </div>
          <button className="secondary sm" disabled={pageSafe >= totalPages} onClick={() => goPage(pageSafe + 1)}>다음 →</button>
        </div>
      )}

      {hasFilter && (
        <p className="muted" style={{ textAlign: "center", marginTop: 14, fontSize: 12 }}>
          필터 적용됨 · {filtered.length}개 중 {pageItems.length}개 표시
          <button className="link-btn" onClick={resetFilters}>초기화</button>
        </p>
      )}
    </div>
  );
}
