"use client";

import { useEffect, useState } from "react";

const REMINDERS = [
  "Trước khi xuất thủ, hãy xem đối phương có nước chiếu, bắt quân hay đe dọa nào không.",
  "Tĩnh tâm ba nhịp. Kiểm tra vua, quân treo và ô yếu rồi mới hạ tử.",
  "Đừng chỉ nhìn nước mình muốn đi. Hãy hỏi: đối thủ muốn làm gì ở nước kế tiếp?",
  "Một quân đứng đẹp chưa chắc hữu dụng. Hãy tìm quân yếu nhất của mình để cải thiện.",
  "Khi thế cờ rối, ưu tiên nước chắc chắn: an toàn vua, phát triển quân và giữ liên kết.",
  "Sau mỗi nước, nhìn lại toàn bàn một lần. Kỳ đạo trọng toàn cục hơn một đòn đẹp mắt.",
];

export default function DaoAmbient() {
  const [reminderIndex, setReminderIndex] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setReminderIndex((index) => (index + 1) % REMINDERS.length);
    }, 14500);

    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="daoAmbient" aria-hidden="true">
      <div className="immortalRealmPhoto" />
      <div className="immortalRealmArt" />
      <div className="immortalLightVeil" />
      <div className="immortalSunHalo" />

      <div className="pinkSeaCloud cloudSeaOne" />
      <div className="pinkSeaCloud cloudSeaTwo" />
      <div className="pinkSeaCloud cloudSeaThree" />
      <div className="pinkSeaCloud cloudSeaFour" />

      <div className="celestialMist celestialMistOne" />
      <div className="celestialMist celestialMistTwo" />

      <div
        key={reminderIndex}
        className={`thaiThanhFlight flightVariant${reminderIndex % 3}`}
      >
        <div className="masterCloudMount">
          <i />
          <i />
          <i />
          <i />
        </div>

        <div className="thaiThanhFigure">
          <div className="masterAuraRing" />

          <div className="masterLayer masterBaseLayer">
            <img src="/dao/taithanh-master.webp" alt="" draggable={false} />
          </div>

          <div className="masterLayer masterHairLayer">
            <img src="/dao/taithanh-master.webp" alt="" draggable={false} />
          </div>

          <div className="masterLayer masterSleeveLayer">
            <img src="/dao/taithanh-master.webp" alt="" draggable={false} />
          </div>

          <div className="masterLayer masterFanLayer">
            <img src="/dao/taithanh-master.webp" alt="" draggable={false} />
          </div>

          <div className="masterMouthMotion" />
          <div className="masterLightSweep" />
          <div className="masterQiRibbon qiRibbonOne" />
          <div className="masterQiRibbon qiRibbonTwo" />
        </div>

        <div className="thaiThanhReminder">
          <strong>Thái Thanh sư phụ</strong>
          <span>{REMINDERS[reminderIndex]}</span>
        </div>
      </div>

      <div className="floatingTalisman talismanA">
        <b>清</b><span>心</span>
      </div>
      <div className="floatingTalisman talismanB">
        <b>觀</b><span>局</span>
      </div>
      <div className="floatingTalisman talismanC">
        <b>守</b><span>一</span>
      </div>
    </div>
  );
}
