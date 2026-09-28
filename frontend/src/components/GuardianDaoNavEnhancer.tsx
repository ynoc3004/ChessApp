"use client";

import { useEffect } from "react";

const paths = [
  { slug: "thanh-long", label: "Thanh Long", note: "Dưỡng Thế · Ngự Cục" },
  { slug: "bach-ho", label: "Bạch Hổ", note: "Sát Phạt · Đoạt Tử" },
  { slug: "chu-tuoc", label: "Chu Tước", note: "Liệt Hỏa · Công Vương" },
  { slug: "huyen-vu", label: "Huyền Vũ", note: "Cố Thủ · Quy Nguyên" },
];

export default function GuardianDaoNavEnhancer() {
  useEffect(() => {
    const enhance = () => {
      const ribbon = document.querySelector<HTMLElement>('[aria-label="Tứ Tượng"]');
      if (!ribbon || ribbon.dataset.daoEnhanced === "true") return;

      const items = Array.from(ribbon.querySelectorAll<HTMLElement>(":scope > span"));
      if (items.length !== paths.length) return;

      ribbon.dataset.daoEnhanced = "true";
      ribbon.setAttribute("aria-label", "Tứ Tượng Đạo Lộ");

      items.forEach((item, index) => {
        const path = paths[index];
        item.classList.add("guardian-dao-link");
        item.dataset.dao = path.slug;
        item.setAttribute("role", "link");
        item.setAttribute("tabindex", "0");
        item.setAttribute("title", `${path.label} Đạo · ${path.note}`);
        item.setAttribute("aria-label", `${path.label} Đạo · ${path.note}`);

        const activate = () => {
          window.location.assign(`/dao/${path.slug}`);
        };
        const onKeyDown = (event: KeyboardEvent) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            activate();
          }
        };

        item.addEventListener("click", activate);
        item.addEventListener("keydown", onKeyDown);
        (item as HTMLElement & { __daoCleanup?: () => void }).__daoCleanup = () => {
          item.removeEventListener("click", activate);
          item.removeEventListener("keydown", onKeyDown);
        };
      });
    };

    enhance();
    const observer = new MutationObserver(enhance);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      document.querySelectorAll<HTMLElement>(".guardian-dao-link").forEach((item) => {
        (item as HTMLElement & { __daoCleanup?: () => void }).__daoCleanup?.();
      });
    };
  }, []);

  return null;
}
