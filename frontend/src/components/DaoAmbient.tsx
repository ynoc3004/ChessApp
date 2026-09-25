"use client";

import type { CSSProperties } from "react";

export default function DaoAmbient() {
  return (
    <div className="daoAmbient phaseOneAmbient" aria-hidden="true">
      <div className="phaseOneBackdrop" />
      <div className="phaseOneGlow" />

      <div className="phaseOneCloud cloudOne" />
      <div className="phaseOneCloud cloudTwo" />
      <div className="phaseOneCloud cloudThree" />
      <div className="phaseOneCloud cloudFour" />

      <div className="phaseOnePetals">
        {Array.from({ length: 16 }, (_, index) => (
          <i
            key={index}
            style={{ "--petal-index": index } as CSSProperties}
          />
        ))}
      </div>

      <div className="phaseOneRune runeLeftTop">清靜</div>
      <div className="phaseOneRune runeRightMid">觀局</div>
      <div className="phaseOneRune runeRightBottom">守心</div>
    </div>
  );
}
