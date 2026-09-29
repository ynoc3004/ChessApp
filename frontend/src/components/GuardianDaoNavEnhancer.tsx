"use client";

import { useEffect } from "react";
import { fallbackDaoPaths, loadDaoPaths, type ManagedDaoPath } from "@/lib/daoStore";

function normalize(value: string | null | undefined) {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function shortLabel(path: ManagedDaoPath) {
  return path.name.replace(/\s+Đạo$/i, "").trim();
}

function resolvePath(element: Element | null, paths: ManagedDaoPath[]) {
  if (!element) return null;
  const label = normalize(element.textContent);
  return paths.find((path) => {
    const short = shortLabel(path);
    return label === short || label === path.name;
  }) ?? null;
}

function findRibbon(paths: ManagedDaoPath[]) {
  const byLabel = document.querySelector<HTMLElement>(
    '[aria-label="Tứ Tượng"], [aria-label="Tứ Tượng Đạo Lộ"]',
  );
  if (byLabel) return byLabel;

  return Array.from(document.querySelectorAll<HTMLElement>("div")).find((element) => {
    const text = normalize(element.textContent);
    return paths.slice(0, 4).every((path) => text.includes(shortLabel(path)));
  }) ?? null;
}

function appendMissingPaths(ribbon: HTMLElement, paths: ManagedDaoPath[]) {
  if (ribbon.tagName !== "DIV") return;
  const present = new Set(
    Array.from(ribbon.querySelectorAll<HTMLElement>("[data-dao]"))
      .map((item) => item.dataset.dao)
      .filter(Boolean),
  );

  paths.forEach((path) => {
    if (present.has(path.slug)) return;
    const separator = document.createElement("i");
    separator.setAttribute("aria-hidden", "true");
    separator.textContent = "✦";
    const item = document.createElement("span");
    item.textContent = shortLabel(path);
    item.dataset.dao = path.slug;
    ribbon.append(separator, item);
  });
}

export default function GuardianDaoNavEnhancer() {
  useEffect(() => {
    let ribbon: HTMLElement | null = null;
    let paths = fallbackDaoPaths();
    let cancelled = false;

    const decorateRibbon = () => {
      ribbon = findRibbon(paths);
      if (!ribbon) return;

      ribbon.dataset.daoEnhanced = "true";
      ribbon.setAttribute("aria-label", "Tứ Tượng Đạo Lộ");

      Array.from(ribbon.children).forEach((child) => {
        if (!(child instanceof HTMLElement)) return;
        const path = child.dataset.dao
          ? paths.find((item) => item.slug === child.dataset.dao)
          : resolvePath(child, paths);
        if (!path) return;

        child.classList.add("guardian-dao-link");
        child.dataset.dao = path.slug;
        child.setAttribute("role", "link");
        child.setAttribute("tabindex", "0");
        child.setAttribute("title", `${path.name} · ${path.epithet}`);
        child.setAttribute("aria-label", `${path.name} · ${path.epithet}`);
      });

      appendMissingPaths(ribbon, paths);
      Array.from(ribbon.children).forEach((child) => {
        if (!(child instanceof HTMLElement) || !child.dataset.dao) return;
        const path = paths.find((item) => item.slug === child.dataset.dao);
        if (!path) return;
        child.classList.add("guardian-dao-link");
        child.setAttribute("role", "link");
        child.setAttribute("tabindex", "0");
        child.setAttribute("title", `${path.name} · ${path.epithet}`);
        child.setAttribute("aria-label", `${path.name} · ${path.epithet}`);
      });
    };

    const open = (target: EventTarget | null) => {
      if (!(target instanceof Element) || !ribbon) return false;
      const candidate = target.closest<HTMLElement>(".guardian-dao-link");
      if (!candidate || !ribbon.contains(candidate)) return false;
      const path = paths.find((item) => item.slug === candidate.dataset.dao) ?? resolvePath(candidate, paths);
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

    void loadDaoPaths().then((loaded) => {
      if (cancelled) return;
      paths = loaded;
      const oldRibbon = ribbon;
      oldRibbon?.removeEventListener("click", onClick);
      oldRibbon?.removeEventListener("keydown", onKeyDown);
      decorateRibbon();
      ribbon?.addEventListener("click", onClick);
      ribbon?.addEventListener("keydown", onKeyDown);
    }).catch(() => {
      // Fallback paths above keep navigation usable without Firebase.
    });

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
      ribbon?.removeEventListener("click", onClick);
      ribbon?.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  return null;
}
