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

  // Fallback in case another terminology layer changes the aria-label.
  return Array.from(document.querySelectorAll<HTMLElement>("div")).find((element) => {
    const text = normalize(element.textContent);
    return PATHS.every((path) => text.includes(path.label));
  }) ?? null;
}

function decorateRibbon() {
  const ribbon = findRibbon();
  if (!ribbon) return;

  ribbon.dataset.daoEnhanced = "true";
  ribbon.setAttribute("aria-label", "Tứ Tượng Đạo Lộ");

  const items = Array.from(ribbon.children).filter(
    (child): child is HTMLElement => child instanceof HTMLElement && Boolean(resolvePath(child)),
  );

  items.forEach((item) => {
    const path = resolvePath(item);
    if (!path) return;

    item.classList.add("guardian-dao-link");
    item.dataset.dao = path.slug;
    item.dataset.href = `/dao/${path.slug}`;
    item.setAttribute("role", "link");
    item.setAttribute("tabindex", "0");
    item.setAttribute("title", `${path.label} Đạo · ${path.note}`);
    item.setAttribute("aria-label", `${path.label} Đạo · ${path.note}`);
  });
}

function targetDaoElement(target: EventTarget | null) {
  if (!(target instanceof Element)) return null;
  const candidate = target.closest<HTMLElement>(".guardian-dao-link, [data-dao]");
  if (!candidate) return null;

  const ribbon = candidate.closest<HTMLElement>('[aria-label="Tứ Tượng Đạo Lộ"], [aria-label="Tứ Tượng"]');
  if (!ribbon) return null;

  const path = candidate.dataset.dao
    ? PATHS.find((item) => item.slug === candidate.dataset.dao)
    : resolvePath(candidate);

  return path ? { candidate, path } : null;
}

export default function GuardianDaoNavEnhancer() {
  useEffect(() => {
    decorateRibbon();

    const observer = new MutationObserver(() => decorateRibbon());
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["aria-label"],
    });

    // Capture phase makes the navigation work even if another UI layer stops
    // bubbling, which can happen with animated/glass hero overlays.
    const onClick = (event: MouseEvent) => {
      const match = targetDaoElement(event.target);
      if (!match) return;
      event.preventDefault();
      event.stopPropagation();
      window.location.href = `/dao/${match.path.slug}`;
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      const match = targetDaoElement(event.target);
      if (!match) return;
      event.preventDefault();
      event.stopPropagation();
      window.location.href = `/dao/${match.path.slug}`;
    };

    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKeyDown, true);

    return () => {
      observer.disconnect();
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, []);

  return null;
}
