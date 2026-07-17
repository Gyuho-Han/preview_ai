"""수기 라벨(상/중/하) 학습 — 개인화 분류 제안의 코어 로직.

사용자가 프로젝트당 일정 개수(기본 20개, settings.label_train_min)를 직접
라벨링하면, 그 라벨로 아주 작은 서열(ordinal) 모델을 학습해 나머지 클립에
AI 제안 라벨을 채운다. 모델은 딱 3파라미터:

    개인화 점수 s = w×연관성 + (1-w)×서사강도,  컷 t_mid < t_high
    s >= t_high → "high"(상), s >= t_mid → "mid"(중), 그 외 "low"(하)

표본 ~20개(클래스당 ~7개)에서는 파라미터당 표본 ~10개 경험칙상 이보다 큰
모델은 과적합한다. w는 "이 유저가 연관성/서사 중 뭘 중시하나"로 해석되어
추후 추천 가중치 개인화에도 재사용할 수 있다. 임베딩 kNN 등 무거운 접근은
클립별 임베딩이 저장되지 않고 n=20에서 노이즈가 커서 v2로 미룬다.

이 모듈은 서버 기동·라벨 저장 경로에서 항상 임포트되므로 무거운 의존성
(numpy·torch 등)을 절대 들이지 않는다 — 순수 파이썬/stdlib만.
"""
from __future__ import annotations

import bisect
import time

RANK = {"low": 0, "mid": 1, "high": 2}

# 라벨 경계에서의 확신도 정규화 폭(점수 단위). 컷에서 이만큼 떨어지면 conf=1.0.
_CONF_SPAN = 15.0

Sample = tuple[float, float, str]  # (relevance, narrative, label)


def _score(w: float, relevance: float, narrative: float) -> float:
    return w * relevance + (1.0 - w) * narrative


def _fit_params(samples: list[Sample]) -> tuple[float, float, float] | None:
    """(w, t_mid, t_high) 그리드서치. 클래스 2개 미만이면 None.

    오차는 서열 거리 |예측랭크-실제랭크| 합(상↔하 혼동을 상↔중보다 2배 벌점).
    동점이면 기본 가중치(0.6)에 가까운 w를 선호해 소표본 요동을 줄인다.
    컷 후보를 인접 점수 중점으로 제한하고 구간별 오차를 prefix 합으로 O(1)에
    평가하므로 표본 수백 개까지도 수 ms면 끝난다.
    """
    pts_all = [(r, n, RANK[lab]) for r, n, lab in samples if lab in RANK]
    if len(pts_all) < 2 or len({rk for _, _, rk in pts_all}) < 2:
        return None

    best: tuple[float, float, float, float, float] | None = None  # (err, |w-0.6|, w, t_mid, t_high)
    for wi in range(0, 21):
        w = wi / 20.0
        pts = sorted((_score(w, r, n), rk) for r, n, rk in pts_all)
        s = [p[0] for p in pts]
        m = len(pts)
        # pref[k][i] = 앞 i개를 전부 랭크 k로 예측했을 때의 서열 오차 합
        pref = [[0] * (m + 1) for _ in range(3)]
        for k in range(3):
            row = pref[k]
            for i, (_, rk) in enumerate(pts):
                row[i + 1] = row[i] + abs(k - rk)
        # 컷 후보: 인접한 서로 다른 점수의 중점 + 전체 아래/위
        cuts = [s[0] - 1.0]
        cuts += [(s[i] + s[i + 1]) / 2.0 for i in range(m - 1) if s[i + 1] > s[i]]
        cuts.append(s[-1] + 1.0)
        idxs = [bisect.bisect_left(s, c) for c in cuts]
        for a in range(len(cuts)):          # t_mid: [0, i)를 low로
            i = idxs[a]
            base = pref[0][i] - pref[1][i]
            for b in range(a, len(cuts)):   # t_high: [i, j)를 mid, [j, m)을 high로
                j = idxs[b]
                err = base + pref[1][j] + (pref[2][m] - pref[2][j])
                key = (err, abs(w - 0.6), w, cuts[a], cuts[b])
                if best is None or key[:2] < best[:2]:
                    best = key
    assert best is not None
    _, _, w, t_mid, t_high = best
    return w, t_mid, t_high


def fit(samples: list[Sample]) -> dict | None:
    """학습된 모델 dict 반환(프로젝트 label_model / 전역 label_seed에 그대로 저장).

    서로 다른 클래스가 2개 미만이면(전부 '상'만 찍는 등) 경계를 배울 수 없어
    None을 반환한다 — 호출부는 모델 미활성으로 처리.
    """
    params = _fit_params(samples)
    if params is None:
        return None
    w, t_mid, t_high = params
    return {
        "w_relevance": round(w, 2),
        "t_mid": round(t_mid, 2),
        "t_high": round(t_high, 2),
        "n_labels": sum(1 for _, _, lab in samples if lab in RANK),
        "loo_acc": loo_accuracy(samples),
        "trained_at": int(time.time()),
    }


def predict(model: dict, relevance: float, narrative: float) -> tuple[str, float]:
    """(라벨, 확신도 0~1). 확신도는 가장 가까운 컷으로부터의 거리 기반."""
    s = _score(model["w_relevance"], relevance, narrative)
    t_mid, t_high = model["t_mid"], model["t_high"]
    if s >= t_high:
        label = "high"
    elif s >= t_mid:
        label = "mid"
    else:
        label = "low"
    margin = min(abs(s - t_mid), abs(s - t_high))
    conf = round(min(1.0, margin / _CONF_SPAN), 2)
    return label, conf


def loo_accuracy(samples: list[Sample]) -> float | None:
    """leave-one-out 정확도(정확 일치율) — "AI 일치도 X%" 지표의 원천.

    표본이 커지면 LOO 재학습 비용이 제곱으로 늘어나므로, 40개를 넘으면
    앞 40개 서브샘플 안에서만 LOO를 돌려 근사한다(라벨 클릭마다 동기 실행되는
    경로라 수백 ms 안에 끝나야 한다).
    """
    pts = [(r, n, lab) for r, n, lab in samples if lab in RANK]
    if len(pts) < 3:
        return None
    if len(pts) > 40:
        pts = pts[:40]
    hit = total = 0
    for i in range(len(pts)):
        rest = pts[:i] + pts[i + 1:]
        params = _fit_params(rest)
        if params is None:
            continue
        w, t_mid, t_high = params
        pred, _ = predict({"w_relevance": w, "t_mid": t_mid, "t_high": t_high},
                          pts[i][0], pts[i][1])
        hit += int(pred == pts[i][2])
        total += 1
    return round(hit / total, 3) if total else None
