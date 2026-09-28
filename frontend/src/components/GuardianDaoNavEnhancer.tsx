"use client";

import { useEffect } from "react";

const PATHS = [
  { slug: "thanh-long", label: "Thanh Long", note: "Dưỡng Thế · Ngự Cục" },
  { slug: "bach-ho", label: "Bạch Hổ", note: "Sát Phạt · Đoạt Tử" },
  { slug: "chu-tuoc", label: "Chu Tước", note: "Liệt Hỏa · Công Vương" },
  { slug: "huyen-vu", label: "Huyền Vũ", note: "Cố Thủ · Quy Nguyên" },
] as const;

function normalize(value: string | null | undefined) {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function resolvePath(element: Element | null) {
  if (!element) return null;
  const label = normalize(element.textContent);
  return PATHS.find((path) => label === path.label || label === `${path.label} Đạo`) ?? null;
}

function findRibbon() {
  const byLabel = document.querySelector<HTMLElement>(
    '[aria-label="Tứ Tượng"], [aria-label="Tứ Tượng Đạo Lộ"]',
  );
  if (byLabel) return byLabel;

  return Array.from(document.querySelectorAll<HTMLElement>("div")).find((element) => {
    const text = normalize(element.textContent);
    return PATHS.every((path) => text.includes(path.label));
  }) ?? null;
}

export default function GuardianDaoNavEnhancer() {
  useEffect(() => {
    let ribbon: HTMLElement | null = null;

    const decorateRibbon = () => {
      ribbon = findRibbon();
      if (!ribbon) return;

      ribbon.dataset.daoEnhanced = "true";
      ribbon.setAttribute("aria-label", "Tứ Tượng Đạo Lộ");

      Array.from(ribbon.children).forEach((child) => {
        if (!(child instanceof HTMLElement)) return;
        const path = resolvePath(child);
        if (!path) return;

        child.classList.add("guardian-dao-link");
        child.dataset.dao = path.slug;
        child.setAttribute("role", "link");
        child.setAttribute("tabindex", "0");
        child.setAttribute("title", `${path.label} Đạo · ${path.note}`);
        child.setAttribute("aria-label", `${path.label} Đạo · ${path.note}`);
      });
    };

    const open = (target: EventTarget | null) => {
      if (!(target instanceof Element) || !ribbon) return false;
      const candidate = target.closest<HTMLElement>(".guardian-dao-link");
      if (!candidate || !ribbon.contains(candidate)) return false;
      const path = PATHS.find((item) => item.slug === candidate.dataset.dao) ?? resolvePath(candidate);
      if (!path) return false;
      window.location.assign(`/dao/${path.slug}`);
      return true;
    };

    const onClick = (event: MouseEvent) => {
      if (open(event.target)) event.preventDefault();
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      if (open(event.target)) event.preventDefault();
    };

    const frame = window.requestAnimationFrame(() => {
      decorateRibbon();
      ribbon?.addEventListener("click", onClick);
      ribbon?.addEventListener("keydown", onKeyDown);
    });

    return () => {
      window.cancelAnimationFrame(frame);
      ribbon?.removeEventListener("click", onClick);
      ribbon?.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  return null;
}
