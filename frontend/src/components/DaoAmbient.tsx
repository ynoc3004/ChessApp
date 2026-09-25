"use client";

import { useEffect, useState, type CSSProperties } from "react";

const REMINDERS = [
  "Trước khi hạ tử, hãy nhìn toàn cục một lần.",
  "Tĩnh tâm: kiểm tra nước chiếu, bắt quân và đe dọa trước.",
  "Đừng vội công. Hãy hỏi quân nào của mình đang đứng kém nhất.",
  "Kỳ đạo quý ở thế. Một nước chắc chắn thường mạnh hơn một nước hoa mỹ.",
  "Sau mỗi nước của đối thủ, hãy hỏi: ý đồ của họ là gì?",
  "Giữ vua an ổn, nối quân thông suốt, rồi mới luận công thủ.",
];

export default function DaoAmbient() {
  const [reminderIndex, setReminderIndex] = useState(0);

  useEffect(() => {
    const root = document.documentElement;

    const onPointerMove = (event: PointerEvent) => {
      const x = event.clientX / Math.max(window.innerWidth, 1) - 0.5;
      const y = event.clientY / Math.max(window.innerHeight, 1) - 0.5;
      root.style.setProperty("--dao-parallax-x", `${(x * 12).toFixed(2)}px`);
      root.style.setProperty("--dao-parallax-y", `${(y * 8).toFixed(2)}px`);
    };

    window.addEventListener("pointermove", onPointerMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      root.style.removeProperty("--dao-parallax-x");
      root.style.removeProperty("--dao-parallax-y");
    };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setReminderIndex((index) => (index + 1) % REMINDERS.length);
    }, 15000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="daoAmbient daoThemeAmbient" aria-hidden="true">
      <div className="daoThemeBackdrop" />
      <div className="daoThemeGlow" />

      <div className="daoCloudVeil cloudVeilOne" />
      <div className="daoCloudVeil cloudVeilTwo" />
      <div className="daoCloudVeil cloudVeilThree" />

      <div className="daoPetals">
        {Array.from({ length: 14 }, (_, index) => (
          <i key={index} style={{ "--petal-index": index } as CSSProperties} />
        ))}
      </div>

      <div className="daoMysticHalo">
        <span>乾</span><span>坎</span><span>艮</span><span>震</span>
        <b>☯</b>
        <span>巽</span><span>離</span><span>坤</span><span>兌</span>
      </div>

      <div
        key={reminderIndex}
        className={`thaiThanhVisit daoMasterVisit visit-${reminderIndex % 3}`}
      >
        <img
          className="thaiThanhSpirit"
          src="/dao/taithanh-spirit.svg"
          alt=""
          draggable={false}
        />
        <div className="thaiThanhReminder daoMasterReminder">
          <strong>Thái Thanh sư phụ</strong>
          <span>{REMINDERS[reminderIndex]}</span>
        </div>
      </div>

      <div className="daoRune runeOne">清心</div>
      <div className="daoRune runeTwo">觀局</div>
      <div className="daoRune runeThree">守一</div>
    </div>
  );
}
