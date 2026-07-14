"""추천도 계산 — weight_relevance×연관성 + weight_narrative×서사강도 (config 설정값).

기술품질(초점·너무 짧음·화면 안 보임)은 점수에 섞지 않는다. 화질이 나쁜 결정적
순간(예: 공항 오열 장면)이 점수 때문에 묻히는 걸 막기 위해 — 대신 quality_warnings()로
경고만 별도로 알린다. 편집자가 판단할 문제이지, 자동으로 걸러낼 문제가 아니기 때문이다.

가중치·임계값은 전부 config.py(Settings)/models.config에서 온다 — 이 파일에 상수로
박아두지 않는 이유는 config.py 자체의 설계 목적("models.config 한 곳에서 모델·
가중치·임계값을 손쉽게 바꿀 수 있다")과 일관되게, 코드 수정 없이 튜닝 가능해야 하기 때문.
"""
from __future__ import annotations

from config import settings


def narrative_score(llm_narrative: float, motion_score: float, face_score: float) -> float:
    """서사강도 0~100 = LLM 감정·사건 판단 + 움직임(역동성) + 얼굴 존재."""
    score = (
        settings.weight_llm_narrative * llm_narrative
        + settings.weight_motion * motion_score
        + settings.weight_face * face_score
    )
    return round(max(0.0, min(100.0, score)), 1)


def recommendation(relevance: float, narrative: float) -> int:
    score = settings.weight_relevance * relevance + settings.weight_narrative * narrative
    return int(round(max(0.0, min(100.0, score))))


def color_for(score: int) -> str:
    if score >= settings.threshold_green:
        return "green"
    if score >= settings.threshold_yellow:
        return "yellow"
    return "red"


def quality_warnings(focus_score: float, duration_sec: float, blank_ratio: float | None) -> list[str]:
    """기술품질 경고 목록(심각한 것만). 점수와 무관하게 참고용 딱지로만 쓰인다.

    blank_ratio=None은 "화면이 잘 보임"이 아니라 "필름스트립을 못 뽑아 애초에 측정
    못 함"을 뜻하므로, 그 경우엔 이 경고를 조용히 건너뛴다(잘못된 "정상" 판정 방지)."""
    warnings: list[str] = []
    if focus_score < settings.focus_warn:
        warnings.append("초점 나감")
    if duration_sec < settings.min_duration_warn:
        warnings.append("너무 짧음")
    if blank_ratio is not None and blank_ratio >= settings.blank_ratio_warn:
        warnings.append("화면 거의 안 보임")
    return warnings
