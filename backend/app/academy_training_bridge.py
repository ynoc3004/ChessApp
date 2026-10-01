from __future__ import annotations

from pathlib import Path

from .academy_game_analysis import practical_profile


def install_practical_training_bridge() -> None:
    """Enrich Academy v2 profiles without mixing practical evidence into Mastery.

    Only repeated, strongly weighted practical evidence with a direct Lichess theme
    may become the next personalized focus. The original skill recommendation is
    retained separately and no Skill Mastery value is modified here.
    """
    from . import academy_training

    current = academy_training.training_profile
    if getattr(current, "_academy_v5_practical", False):
        return
    base_profile = current

    def training_profile_with_practical(student_id: str, database: Path | None = None, now: float | None = None):
        profile = base_profile(student_id, database, now)
        practical = practical_profile(student_id, database)
        profile["practical"] = practical
        recommendation = practical.get("recommendation")
        if (
            recommendation
            and recommendation.get("theme")
            and practical.get("gamesAnalyzed", 0) >= 2
            and recommendation.get("evidenceWeight", 0) >= 6
        ):
            profile["skillRecommendation"] = dict(profile["recommendation"])
            profile["recommendation"] = {
                "skill": f"Thực chiến · {recommendation['label']}",
                "theme": recommendation["theme"],
                "themeLabel": recommendation["label"],
                "reason": "Practical Profile ghi nhận nhóm lỗi này lặp lại đủ nhiều trong ván thi đấu; ưu tiên một lượt Bí Cảnh để bù điểm yếu thực chiến.",
            }
        return profile

    training_profile_with_practical._academy_v5_practical = True  # type: ignore[attr-defined]
    academy_training.training_profile = training_profile_with_practical
