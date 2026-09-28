"use client";

import { useEffect } from "react";

const terms = new Map<string, string>([
  ["02 / TIẾP TỤC KHÁM PHÁ", "02 / TỤC THAM KỲ ĐẠO"],
  ["Kỳ phổ của bạn", "Bản Mệnh Kỳ Phổ"],
  ["Đang tải thư viện…", "Đang triệu hồi Tàng Kinh Các…"],
  ["Thử lại", "Tái Thử"],
  ["Cuốn kỳ phổ đầu tiên đang chờ bạn", "Tàng Kinh Các thượng vô kỳ phổ"],
  ["Sách đã quét sẽ xuất hiện ở đây để bạn tiếp tục học bất cứ lúc nào.", "Kỳ phổ hậu khai sẽ nhập các, khả tùy thời tái tham."],
  ["Nhập sách đầu tiên ↑", "Nạp Sơ Kỳ Phổ ↑"],
  ["Mở sách", "Khai Phổ"],
  ["Tải ảnh ZIP", "Thu Kỳ Đồ ZIP"],
  ["KỲ PHỔ ·", "KỲ PHỔ ·"],
  ["Tìm theo trang sách", "Tầm theo Cổ Phổ Trang"],
  ["Xóa lọc", "Giải Lọc"],
  ["Tải toàn bộ ảnh", "Thu Toàn Kỳ Đồ"],
  ["Phân tích thế cờ →", "Diễn Toán Kỳ Thế →"],
  ["← Trang trước", "← Tiền Trang"],
  ["Trang sau →", "Hậu Trang →"],
  ["Tĩnh tâm học cờ · Từng nước tiến bộ", "Tĩnh tâm tham kỳ · Bộ bộ tinh tiến"],
  ["Sẵn sàng để quét", "Dĩ khả khai phổ"],
  ["Tiến trình quét", "Khai phổ tiến trình"],
  ["Vui lòng chọn sách định dạng PDF hoặc DOCX.", "Thỉnh tuyển kỳ phổ định dạng PDF hoặc DOCX."],
  ["Không tải được thư viện", "Tàng Kinh Các triệu hồi thất bại"],
  ["Chưa kết nối được thư viện. Kiểm tra dịch vụ xử lý sách rồi thử lại.", "Vị liên thông Tàng Kinh Các. Thỉnh kiểm tra khai phổ pháp vụ rồi tái thử."],
  ["Không khôi phục được lần quét trước", "Tiền khai phổ ký lục vô pháp hồi phục"],
  ["Không bắt đầu quét được", "Khai phổ vô pháp khởi động"],
  ["Không đọc được tiến trình quét", "Khai phổ tiến trình vô pháp hồi báo"],
  ["Quét sách thất bại", "Khai phổ thất bại"],
  ["Có lỗi xảy ra", "Phát sinh dị thường"],
  ["Không xóa được", "Tiêu trừ thất bại"],
  ["Không tìm thấy hình cờ", "Vị tầm đắc kỳ đồ"],
  ["Chess position", "Kỳ trận"],
]);

const rules: Array<[RegExp, string]> = [
  [/(\d+) cuốn sách/g, "$1 quyển kỳ phổ"],
  [/(\d+) hình cờ/g, "$1 kỳ đồ"],
  [/(\d+) thế cờ trong sách/g, "$1 kỳ thế trong cổ phổ"],
  [/Không tìm thấy hình cờ ở trang PDF (\d+)\./g, "Vị tầm đắc kỳ đồ tại PDF trang $1."],
  [/Trang \/ ảnh nguồn:/g, "Cổ phổ trang / nguyên đồ:"],
  [/độ tin cậy detector/g, "thức đồ linh ứng"],
  [/Phân tích thế cờ/g, "Diễn Toán Kỳ Thế"],
  [/Tải ảnh/g, "Thu Kỳ Đồ"],
  [/Tải toàn bộ ảnh/g, "Thu Toàn Kỳ Đồ"],
  [/Tìm theo trang sách/g, "Tầm theo Cổ Phổ Trang"],
  [/Đang tải thư viện/g, "Đang triệu hồi Tàng Kinh Các"],
  [/Xóa dữ liệu đã quét của "([^"]+)" khỏi máy\? Các diagram của job này cũng sẽ bị xóa\./g, "Tiêu trừ khai phổ kỳ liệu của \"$1\" khỏi bản địa? Toàn bộ kỳ đồ thuộc pháp vụ này đồng thời tiêu trừ."],
  [/Sẵn sàng để quét/g, "Dĩ khả khai phổ"],
  [/Mở sách/g, "Khai Phổ"],
  [/Xóa lọc/g, "Giải Lọc"],
  [/Trang trước/g, "Tiền Trang"],
  [/Trang sau/g, "Hậu Trang"],
];

function convert(input: string) {
  const trimmed = input.trim();
  const exact = terms.get(trimmed);
  if (exact) {
    const left = input.match(/^\s*/)?.[0] ?? "";
    const right = input.match(/\s*$/)?.[0] ?? "";
    return `${left}${exact}${right}`;
  }
  let value = input;
  for (const [pattern, replacement] of rules) value = value.replace(pattern, replacement);
  return value;
}

function apply(root: ParentNode) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let cursor = walker.nextNode();
  while (cursor) {
    const text = cursor as Text;
    if (!text.parentElement?.closest("script, style, code, pre")) {
      const next = convert(text.data);
      if (next !== text.data) text.data = next;
    }
    cursor = walker.nextNode();
  }

  const elements = root instanceof Element
    ? [root, ...Array.from(root.querySelectorAll("[title], [aria-label], [placeholder], [alt]"))]
    : Array.from(root.querySelectorAll("[title], [aria-label], [placeholder], [alt]"));

  for (const element of elements) {
    for (const attr of ["title", "aria-label", "placeholder", "alt"]) {
      const value = element.getAttribute(attr);
      if (!value) continue;
      const next = convert(value);
      if (next !== value) element.setAttribute(attr, next);
    }
  }
}

export default function HanVietSupplement() {
  useEffect(() => {
    apply(document.body);

    // Batch newly mounted React nodes once per animation frame. We deliberately
    // avoid observing characterData/attributes because those mutations were
    // causing excessive work together with Next.js HMR and the navigation layer.
    const pending = new Set<ParentNode>();
    let frame = 0;

    const flush = () => {
      frame = 0;
      const roots = Array.from(pending);
      pending.clear();
      roots.forEach((root) => apply(root));
    };

    const schedule = (root: ParentNode) => {
      pending.add(root);
      if (!frame) frame = window.requestAnimationFrame(flush);
    };

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        mutation.addedNodes.forEach((node) => {
          if (node instanceof Element) schedule(node);
          else if (node instanceof Text && node.parentElement) schedule(node.parentElement);
        });
      }
    });

    observer.observe(document.body, { subtree: true, childList: true });

    const previousConfirm = window.confirm.bind(window);
    window.confirm = (message?: string) => previousConfirm(convert(String(message ?? "")));

    return () => {
      observer.disconnect();
      if (frame) window.cancelAnimationFrame(frame);
      pending.clear();
      window.confirm = previousConfirm;
    };
  }, []);

  return null;
}
