"use client";

import { useEffect, useState } from "react";

const REMINDERS = [
  "Trước khi xuất thủ, hãy xem đối phương có nước chiếu, bắt quân hay đe dọa nào không.",
  "Tĩnh tâm ba nhịp: kiểm tra vua, quân treo và ô yếu rồi mới hạ tử.",
  "Đừng chỉ nhìn nước mình muốn đi. Hãy hỏi đối thủ muốn làm gì ở nước kế tiếp.",
  "Một quân đứng đẹp chưa chắc hữu dụng. Hãy tìm quân yếu nhất của mình để cải thiện.",
  "Khi thế cờ rối, ưu tiên nước chắc chắn: an toàn vua, phát triển quân và giữ liên kết.",
  "Sau mỗi nước, nhìn lại toàn bàn một lần. Kỳ đạo trọng toàn cục hơn một đòn đẹp mắt.",
];

export default function DaoAmbient() {
  const [reminderIndex, setReminderIndex] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setReminderIndex((index) => (index + 1) % REMINDERS.length);
    }, 15000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="daoAmbient" aria-hidden="true">
      <div className="celestialBackdrop" />
      <div className="celestialGodRays" />

      <div className="movingCloud cloudFrontOne" />
      <div className="movingCloud cloudFrontTwo" />
      <div className="movingCloud cloudMidOne" />
      <div className="movingCloud cloudMidTwo" />

      <div
        key={reminderIndex}
        className={`thaiThanhVisit visit-${reminderIndex % 3}`}
      >
        <img
          className="thaiThanhSpirit"
          src="/dao/taithanh-spirit.svg"
          alt=""
          draggable={false}
        />

        <div className="thaiThanhReminder">
          <strong>Thái Thanh sư phụ</strong>
          <span>{REMINDERS[reminderIndex]}</span>
        </div>
      </div>

      <div className="mysticSeal sealOne"><b>清</b><span>靜</span></div>
      <div className="mysticSeal sealTwo"><b>觀</b><span>局</span></div>
      <div className="mysticSeal sealThree"><b>守</b><span>心</span></div>
    </div>
  );
}
