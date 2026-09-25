"use client";

import { useEffect, useState } from "react";

const REMINDERS = [
  "Trước khi động quân, hãy nhìn xem đối phương đang đe dọa gì.",
  "Tĩnh tâm ba nhịp: kiểm tra chiếu, bắt quân và đòn chiến thuật.",
  "Nước đơn giản nhưng chắc chắn thường tốt hơn nước hoa mỹ.",
  "Sau mỗi nước, hãy nhìn lại toàn bàn cờ một lần.",
  "Muốn công thì trước hết phải giữ vua an ổn.",
  "Đừng vội xuất chiêu: kiểm tra quân treo và ô yếu trước đã.",
];

export default function DaoAmbient() {
  const [reminderIndex, setReminderIndex] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setReminderIndex((index) => (index + 1) % REMINDERS.length);
    }, 11000);

    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="daoAmbient" aria-hidden="true">
      <div className="daoPhotoBackdrop" />
      <div className="daoDawnVeil" />
      <div className="daoSunGlow" />

      <div className="immortalCloud cloudOne" />
      <div className="immortalCloud cloudTwo" />
      <div className="immortalCloud cloudThree" />
      <div className="immortalCloud cloudFour" />

      <div className="daoMist mistOne" />
      <div className="daoMist mistTwo" />
      <div className="daoMist mistThree" />

      <div
        key={reminderIndex}
        className={`daoMasterScene pose-${reminderIndex % 2}`}
      >
        <div className="daoMasterAura" />

        <div className="daoMasterViewport">
          <img
            className="daoMasterImage"
            src="/dao/taithanh-master.webp"
            alt=""
            draggable={false}
          />
          <div className="daoMasterSheen" />
          <div className="daoMasterCloudRibbon ribbonOne" />
          <div className="daoMasterCloudRibbon ribbonTwo" />
        </div>

        <div className="daoMasterBubble">
          <span>Thái Thanh sư phụ</span>
          {REMINDERS[reminderIndex]}
        </div>
      </div>

      <div className="softTalisman talismanOne">清静</div>
      <div className="softTalisman talismanTwo">观局</div>
      <div className="softTalisman talismanThree">守心</div>
    </div>
  );
}
