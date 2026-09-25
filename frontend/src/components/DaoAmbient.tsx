"use client";

import { useEffect, useState } from "react";

const REMINDERS = [
  "Thái Thanh sư phụ nhắc: trước khi động quân, hãy nhìn xem đối phương đang đe dọa gì.",
  "Thái Thanh sư phụ nhắc: tĩnh tâm ba nhịp — kiểm tra chiếu, bắt quân và đòn chiến thuật.",
  "Thái Thanh sư phụ nhắc: nước đơn giản nhưng chắc chắn thường tốt hơn nước hoa mỹ.",
  "Thái Thanh sư phụ nhắc: sau mỗi nước, hãy nhìn lại toàn bàn cờ một lần.",
  "Thái Thanh sư phụ nhắc: muốn công thì trước hết phải giữ vua an ổn.",
  "Thái Thanh sư phụ nhắc: đừng vội xuất chiêu — hãy kiểm tra quân treo và ô yếu.",
];

export default function DaoAmbient() {
  const [reminderIndex, setReminderIndex] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setReminderIndex((index) => (index + 1) % REMINDERS.length);
    }, 12000);

    return () => window.clearInterval(timer);
  }, []);

  const reverse = reminderIndex % 2 === 1;

  return (
    <div className="daoAmbient" aria-hidden="true">
      <div className="skyGlow" />

      <div className="daoSkyMist mistOne" />
      <div className="daoSkyMist mistTwo" />
      <div className="daoSkyMist mistThree" />

      <div className="pinkCloud cloudOne"><i /><i /><i /></div>
      <div className="pinkCloud cloudTwo"><i /><i /><i /></div>
      <div className="pinkCloud cloudThree"><i /><i /><i /></div>
      <div className="pinkCloud cloudFour"><i /><i /><i /></div>

      <div className="daoMountainRange mountainFar" />
      <div className="daoMountainRange mountainMid" />
      <div className="daoMountainRange mountainNear" />

      <div className="softTalisman talismanOne">清静</div>
      <div className="softTalisman talismanTwo">观局</div>
      <div className="softTalisman talismanThree">守心</div>

      <div
        key={reminderIndex}
        className={`daoFriendFlight ${reverse ? "reverse" : ""}`}
      >
        <div className="daoFriendBubble">
          <span>Thái Thanh sư phụ</span>
          {REMINDERS[reminderIndex]}
        </div>

        <div className="daoFriendSprite">
          <svg viewBox="0 0 220 112" role="img">
            <defs>
              <linearGradient id="sunriseRobe" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#fffaf4" />
                <stop offset=".52" stopColor="#f4ddd2" />
                <stop offset="1" stopColor="#d8b7ad" />
              </linearGradient>
              <linearGradient id="sunriseSword" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0" stopColor="#798793" />
                <stop offset=".5" stopColor="#f7efd9" />
                <stop offset="1" stopColor="#798793" />
              </linearGradient>
            </defs>

            <path d="M21 91 L194 85 L207 89 L190 94 L23 98 Z" fill="url(#sunriseSword)" opacity=".95" />
            <path d="M35 93 L17 103 L30 86" fill="none" stroke="#e3c382" strokeWidth="2.2" />

            <circle cx="123" cy="28" r="12.5" fill="#f1d6ba" />
            <path d="M110 22 Q122 3 137 22 Q126 15 110 22" fill="#5a5350" />
            <path d="M112 18 Q124 7 135 19" fill="none" stroke="#d4bb8b" strokeWidth="2" />

            <path d="M116 42 Q97 51 91 82 L151 79 Q141 51 129 42 Z" fill="url(#sunriseRobe)" />
            <path d="M122 44 L122 78" stroke="#d3a890" strokeWidth="2" opacity=".72" />

            <path d="M107 49 Q80 59 61 74" fill="none" stroke="#f2e2d8" strokeWidth="6.2" strokeLinecap="round" />
            <path d="M134 49 Q154 59 173 72" fill="none" stroke="#f2e2d8" strokeWidth="6.2" strokeLinecap="round" />

            <path d="M107 79 L98 92 M134 78 L142 91" stroke="#5d514c" strokeWidth="4.2" strokeLinecap="round" />
            <path d="M102 82 Q124 72 153 80" fill="none" stroke="#d8b570" strokeWidth="2.2" opacity=".8" />

            <circle cx="119" cy="28" r="1.4" fill="#403a37" />
            <circle cx="128" cy="28" r="1.4" fill="#403a37" />
            <path d="M120 34 Q124 36 129 34" fill="none" stroke="#7f6d63" strokeWidth="1.2" />
          </svg>
        </div>
      </div>
    </div>
  );
}
