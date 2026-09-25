"use client";

import type { CSSProperties } from "react";

export default function DaoAmbient() {
  return (
    <div className="daoAmbient phaseOneAmbient" aria-hidden="true">
      <div className="phaseGifScene phaseGifSceneA" />
      <div className="phaseGifScene phaseGifSceneB" />

      <div className="phaseGifGlow" />

      <div className="phaseGifCloud cloudA" />
      <div className="phaseGifCloud cloudB" />
      <div className="phaseGifCloud cloudC" />

      <div className="phaseGifPetals">
        {Array.from({ length: 18 }, (_, index) => (
          <i
            key={index}
            style={{ "--petal-index": index } as CSSProperties}
          />
        ))}
      </div>
    </div>
  );
}
