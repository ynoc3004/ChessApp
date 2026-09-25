"use client";

import { useEffect, useState } from "react";

const REMINDERS = [
  "Đạo hữu, trước khi động quân hãy xem đối phương đang đe dọa gì.",
  "Tĩnh tâm ba nhịp: kiểm tra nước chiếu, nước bắt và nước đe dọa.",
  "Một quân đứng đẹp chưa chắc đã hữu dụng — hãy tìm quân yếu nhất của mình.",
  "Đừng vội xuất chiêu. Xem lại vua, quân treo và ô yếu trước khi đi.",
  "Kỳ đạo trọng toàn cục: sau mỗi nước, hãy nhìn lại cả bàn một lần.",
  "Gặp thế khó thì lui một bước quan trận; nước đơn giản thường bền hơn nước hoa mỹ.",
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
      <div className="daoSkyMist mistOne" />
      <div className="daoSkyMist mistTwo" />
      <div className="daoSkyMist mistThree" />

      <div className="daoCloud cloudOne"><i /><i /><i /></div>
      <div className="daoCloud cloudTwo"><i /><i /><i /></div>
      <div className="daoCloud cloudThree"><i /><i /><i /></div>
      <div className="daoCloud cloudFour"><i /><i /><i /></div>

      <div className="daoMountainRange mountainFar" />
      <div className="daoMountainRange mountainMid" />
      <div className="daoMountainRange mountainNear" />

      <div className="daoTalisman talismanOne">
        <span className="talismanSeal">敕</span>
        <b>清</b><em>心</em><b>定</b><em>神</em>
      </div>
      <div className="daoTalisman talismanTwo">
        <span className="talismanSeal">鎮</span>
        <b>觀</b><em>勢</em><b>守</b><em>一</em>
      </div>
      <div className="daoTalisman talismanThree">
        <span className="talismanSeal">護</span>
        <b>靜</b><em>思</em><b>後</b><em>行</em>
      </div>

      <div
        key={reminderIndex}
        className={`daoFriendFlight ${reverse ? "reverse" : ""}`}
      >
        <div className="daoFriendBubble">
          <span>道友</span>
          {REMINDERS[reminderIndex]}
        </div>

        <div className="daoFriendSprite">
          <svg viewBox="0 0 180 92" role="img">
            <defs>
              <linearGradient id="robe" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#d9ddc4" />
                <stop offset="1" stopColor="#68836b" />
              </linearGradient>
              <linearGradient id="sword" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0" stopColor="#6e8175" />
                <stop offset=".5" stopColor="#e7dfbd" />
                <stop offset="1" stopColor="#6e8175" />
              </linearGradient>
            </defs>

            <path d="M17 75 L163 70 L174 74 L160 78 L18 82 Z" fill="url(#sword)" opacity=".95" />
            <path d="M28 78 L12 86 L24 72" fill="none" stroke="#d9c48c" strokeWidth="2" />
            <circle cx="100" cy="24" r="11" fill="#d7c8a6" />
            <path d="M91 17 Q100 3 110 18 Q101 13 91 17" fill="#161b17" />
            <path d="M99 34 Q84 43 80 67 L123 65 Q116 42 106 34 Z" fill="url(#robe)" />
            <path d="M92 41 Q69 48 55 61" fill="none" stroke="#bcc8b3" strokeWidth="6" strokeLinecap="round" />
            <path d="M110 41 Q128 49 141 59" fill="none" stroke="#bcc8b3" strokeWidth="6" strokeLinecap="round" />
            <path d="M94 63 L87 76 M111 63 L119 75" stroke="#171c17" strokeWidth="4" strokeLinecap="round" />
            <path d="M78 67 Q100 58 126 67" fill="none" stroke="#c4a56a" strokeWidth="2" opacity=".8" />
            <circle cx="96" cy="23" r="1.5" fill="#20251f" />
            <circle cx="104" cy="23" r="1.5" fill="#20251f" />
          </svg>
        </div>
      </div>
    </div>
  );
}
