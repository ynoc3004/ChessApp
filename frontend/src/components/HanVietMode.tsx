"use client";

import { useEffect } from "react";

/**
 * Centralized Hán-Việt terminology layer.
 *
 * The chess reader already has a fairly large UI and many status messages are
 * generated dynamically while a book is being scanned or a position is being
 * analysed. Keeping the terminology here lets the theme stay consistent
 * without touching engine/API values such as FEN, Stockfish, Lichess or file
 * names.
 */

const exactTerms = new Map<string, string>([
  // Global / home navigation
  ["Không gian học cờ của bạn", "Kỳ đạo tu tập tĩnh thất"],
  ["Nhập kỳ phổ", "Nạp Kỳ Phổ"],
  ["Thư viện", "Tàng Kinh Các"],
  ["Đến phần nhập sách", "Di chuyển đến Nạp Kỳ Phổ"],

  // Hero
  ["TÀNG KINH CÁC · HỌC CỜ TỪ SÁCH", "TÀNG KINH CÁC · THAM NGỘ KỲ ĐẠO"],
  ["Mỗi thế cờ,", "Nhất cục nhất ngộ,"],
  ["một điều khai mở.", "khai minh kỳ đạo."],
  [
    "Mang kỳ phổ lên bàn cờ. Tách hình từ sách, thử từng nước đi và khám phá thế trận cùng Stockfish.",
    "Nạp kỳ phổ, phân ly kỳ đồ, diễn biến chư thủ và tham ngộ thế trận cùng Stockfish.",
  ],
  ["Bắt đầu với một cuốn sách", "Khai quyển nhập đạo"],
  ["BÁT QUÁI · TỨ TƯỢNG", "BÁT QUÁI · TỨ TƯỢNG"],
  ["Tĩnh tâm quan cục", "Tĩnh tâm quan cục"],

  // Import / scan
  ["01 / KHAI PHỔ", "01 / KHAI PHỔ"],
  ["Nhập sách của bạn", "Nạp Kỳ Phổ"],
  ["Kéo sách vào đây", "Thỉnh Kỳ Phổ nhập các"],
  ["hoặc bấm để chọn tệp PDF / DOCX", "Hoặc điểm tuyển kỳ phổ PDF / DOCX"],
  ["Quét sách và tìm thế cờ →", "Khai phổ · Tầm kỳ trận →"],
  ["Đang quét kỳ phổ…", "Đang khai phổ…"],
  ["Sách được gửi đến dịch vụ xử lý bạn đã cấu hình.", "Kỳ phổ được truyền nhập bản địa pháp khí xử lý."],
  ["Đang đọc thông tin tài liệu", "Đang duyệt khảo kỳ phổ"],
  ["CẢNH GIỚI QUÉT PHỔ", "KHAI PHỔ CẢNH GIỚI"],
  ["Tụ Khí", "Tụ Khí"],
  ["Đang chuẩn bị pháp trận xử lý", "Đang kết lập khai phổ pháp trận"],
  ["Khai Phổ", "Khai Phổ"],
  ["Mở kinh quyển, định vị kỳ đồ", "Khai kinh quyển · định vị kỳ đồ"],
  ["Quan Trận", "Quan Trận"],
  ["Dò tìm thế cờ trong cổ phổ", "Tầm kỳ thế ẩn tàng trong cổ phổ"],
  ["Ngộ Cục", "Ngộ Cục"],
  ["Tách trận đồ, hội tụ kỳ thế", "Phân ly trận đồ · hội tụ kỳ thế"],
  ["Khắc Ấn", "Khắc Ấn"],
  ["Hoàn thiện dữ liệu và nhập tàng", "Hoàn thiện kỳ liệu · nhập tàng"],
  ["Viên Mãn", "Viên Mãn"],
  ["Kỳ phổ đã nhập Tàng Kinh Các", "Kỳ phổ dĩ nhập Tàng Kinh Các"],
  ["☁ Đang triệu hồi kỳ phổ gần nhất từ Tàng Kinh Các…", "☁ Đang triệu hồi cận kỳ phổ từ Tàng Kinh Các…"],
  ["Đã quét xong nhưng chưa tìm thấy hình cờ. Thử sách có hình bàn cờ rõ hơn.", "Khai phổ hoàn tất, vị kiến kỳ đồ. Thỉnh tuyển kỳ phổ có trận đồ minh hiển hơn."],

  // Guide
  ["HÀNH TRÌNH HỌC CỜ", "KỲ ĐẠO TU HÀNH"],
  ["Từ trang sách", "Từ cổ phổ"],
  ["đến bàn cờ.", "nhập kỳ trận."],
  ["Chọn kỳ phổ", "Tuyển Kỳ Phổ"],
  ["Tải sách PDF hoặc DOCX bạn muốn học.", "Nạp kỳ phổ PDF hoặc DOCX sở tuyển."],
  ["Khám phá thế cờ", "Tầm Kỳ Thế"],
  ["Xem các hình cờ tìm được, lọc theo trang sách.", "Duyệt kỳ đồ đã tầm đắc, tuyển lọc theo cổ phổ trang số."],
  ["Thử nước, hiểu sâu", "Diễn Biến · Ngộ Cục"],
  ["Kiểm tra bàn cờ nhận diện và phân tích bằng Stockfish.", "Hiệu nghiệm trận đồ, diễn toán kỳ cục bằng Stockfish."],
  ["Một thế cờ hay đáng để bạn dừng lại.", "Nhất cục hữu ngộ, khả đình tâm tham cứu."],

  // Library / gallery common vocabulary
  ["Sách đã quét gần đây", "Cận Nhật Kỳ Phổ"],
  ["Các sách đã quét gần đây", "Cận Nhật Kỳ Phổ"],
  ["Tìm thấy", "Tầm đắc"],
  ["hình cờ", "kỳ đồ"],
  ["Tải ảnh", "Thu kỳ đồ"],
  ["Tải tất cả ảnh (.zip)", "Thu toàn bộ kỳ đồ (.zip)"],
  ["Xuất FEN đã nhận (.json)", "Xuất kỳ văn FEN (.json)"],
  ["Xuất FEN", "Xuất Kỳ Văn"],
  ["Mở gallery", "Khai Kỳ Các"],
  ["Xóa", "Tiêu trừ"],
  ["AI đọc FEN & phân tích", "AI thức đồ · diễn toán"],
  ["Trang / ảnh nguồn:", "Cổ phổ trang / nguyên đồ:"],
  ["độ tin cậy detector", "linh ứng thức đồ"],
  ["TRUY TÌM THEO TRANG CỔ PHỔ", "TẦM KIẾM THEO CỔ PHỔ TRANG"],
  ["Thu toàn bộ ảnh", "Thu toàn bộ kỳ đồ"],
  ["Xuất kỳ văn FEN", "Xuất Kỳ Văn FEN"],

  // Analysis top bar / source
  ["Kỳ đồ từ cổ phổ", "Cổ Phổ Kỳ Đồ"],
  ["Đang quan sát trận đồ…", "Đang quan trận thức đồ…"],
  ["Nguyên đồ dùng để đối chiếu", "Nguyên đồ đối chiếu"],
  ["Thi triển lại", "Tái Thi Pháp"],
  ["Không có ảnh nguồn.", "Khuyết nguyên đồ."],
  ["Pháp khí AI", "AI Pháp Khí"],
  ["Linh ứng", "Linh Ứng"],
  ["Tạp niệm", "Tạp Niệm"],
  ["← Tiền trận", "← Tiền Trận"],
  ["Tàng Các", "Tàng Kinh Các"],
  ["Hậu trận →", "Hậu Trận →"],

  // Main chess board
  ["Bày trận", "Bố Trận"],
  ["Diễn hóa", "Diễn Hóa"],
  ["✓ Trận pháp ổn định", "✓ Trận Pháp An Định"],
  ["⚠ Trận pháp hỗn loạn", "⚠ Trận Pháp Hỗn Loạn"],
  ["↓ Tải kỳ đồ PNG", "↓ Thu Kỳ Đồ PNG"],
  ["Tải đúng kỳ đồ đang hiển thị thành PNG", "Thu hiện hành kỳ đồ thành PNG"],
  ["Trắng đi", "Bạch Phương Hành"],
  ["Đen đi", "Hắc Phương Hành"],
  ["Thu kỳ đồ", "Thu Kỳ Đồ"],
  ["Thu ảnh diễn hóa", "Thu Diễn Hóa Đồ"],
  ["Chuyển trận", "Chuyển Trận"],

  // Tool tabs / editor
  ["Sửa quân", "Hiệu Quân"],
  ["Phân tích", "Diễn Toán"],
  ["Ô linh ứng bất định:", "Bất Định Linh Ứng Vị:"],
  ["Vị trí đang điểm", "Hiện Hành Định Vị"],
  ["Trắng", "Bạch"],
  ["Đen", "Hắc"],
  ["Xóa quân", "Khử Quân"],
  ["Hồi chiêu", "Hồi Chiêu"],
  ["Tán trận", "Tán Trận"],
  ["Hồi nguyên AI", "AI Hồi Nguyên"],
  ["Thu pháp", "Thu Pháp"],
  ["Phương vị cổ phổ", "Cổ Phổ Phương Vị"],
  ["Bạch phương dưới", "Bạch Phương Hạ"],
  ["Hắc phương dưới", "Hắc Phương Hạ"],

  // FEN
  ["Kỳ văn FEN hiện tại", "Hiện Hành Kỳ Văn FEN"],
  ["Nạp kỳ văn", "Nạp Kỳ Văn"],
  ["Sao chép kỳ văn", "Sao Lục Kỳ Văn"],
  ["Đang lưu…", "Đang Khắc Ấn…"],
  ["✓ Đã lưu", "✓ Dĩ Khắc Ấn"],
  ["Khắc ấn bản sửa", "Khắc Ấn Hiệu Bản"],
  ["Nhập thành", "Nhập Thành"],
  ["Bắt tốt qua đường", "Quá Lộ Thủ Tốt (en passant)"],

  // Engine
  ["Hồi nguyên", "Hồi Nguyên"],
  ["Tự vận công", "Tự Vận Công"],
  ["Tầng tâm pháp", "Tâm Pháp Tầng"],
  ["Đang tính…", "Đang Diễn Toán…"],
  ["Vận Tâm pháp Stockfish", "Vận Stockfish Tâm Pháp"],
  [
    "Kéo quân trên bàn nhỏ để thử nước. Thanh bên trái cập nhật ưu thế Trắng/Đen sau khi Stockfish tính xong.",
    "Di quân tại tiểu bàn để diễn biến. Tả trắc ưu thế Bạch/Hắc sẽ hồi báo sau khi Stockfish diễn toán hoàn tất.",
  ],

  // Dynamic status / errors that appear in DOM
  ["AI đang đọc hình cờ…", "AI đang thức đồ…"],
  ["AI recognition failed", "AI thức đồ thất bại"],
  ["Không có bộ nhận dạng nào đọc được thế cờ này.", "Vô thức đồ pháp khí khả giải kỳ trận này."],
  ["Không nhận dạng được thế cờ", "Kỳ trận thức đồ thất bại"],
  ["Đã nạp FEN.", "Kỳ văn FEN dĩ nhập trận."],
  ["FEN đã nạp nhưng vị trí chưa hợp lệ.", "Kỳ văn FEN dĩ nhập, nhiên trận thế bất hợp lệ."],
  ["FEN không hợp lệ", "Kỳ văn FEN bất hợp lệ"],
  ["Nước đi không hợp lệ.", "Kỳ thủ bất hợp lệ."],
  ["Đã hồi nguyên trận thế theo kỳ đồ AI.", "Dĩ hồi nguyên trận thế y AI kỳ đồ."],
  ["Không lưu được thế cờ", "Khắc ấn kỳ thế thất bại"],
  ["Đã copy FEN.", "Kỳ văn FEN dĩ sao lục."],
  ["Không copy tự động được.", "Kỳ văn vô pháp tự động sao lục."],
  ["Đang họa lại trận đồ…", "Đang họa chế trận đồ…"],
  ["Đã tải kỳ đồ sau khi thi triển.", "Kỳ đồ hậu thi pháp dĩ thu."],
  ["Đã tải kỳ đồ sau khi diễn hóa.", "Diễn hóa kỳ đồ dĩ thu."],
  ["Không tạo được ảnh bàn cờ.", "Kỳ đồ họa chế thất bại."],
  ["Thế cờ phân tích chưa hợp lệ.", "Diễn toán kỳ thế bất hợp lệ."],
  ["Tâm pháp Stockfish đang vận chuyển trên máy…", "Stockfish Tâm Pháp đang bản địa vận chuyển…"],
  ["Tâm pháp đã diễn hóa xong kỳ cục.", "Tâm Pháp dĩ diễn toán hoàn tất kỳ cục."],
  ["Tâm pháp chưa trả về biến thể.", "Tâm Pháp vị hồi báo biến thức."],
  ["Không vận chuyển được Tâm pháp Stockfish.", "Stockfish Tâm Pháp vận chuyển thất bại."],

  // Accessibility / alt copy
  ["Chess diagram from book", "Cổ phổ kỳ đồ"],
  ["Chọn sách PDF hoặc DOCX", "Tuyển kỳ phổ PDF hoặc DOCX"],
]);

const fragmentRules: Array<[RegExp, string]> = [
  [/Không gian học cờ của bạn/g, "Kỳ đạo tu tập tĩnh thất"],
  [/Đã xử lý (\d+) \/ (\d+)/g, "Dĩ hành pháp $1 / $2"],
  [/đã lĩnh hội (\d+) kỳ đồ/g, "lĩnh hội $1 kỳ đồ"],
  [/Đã đọc bằng /g, "Dĩ thức đồ bằng "],
  [/độ tin cậy trung bình/g, "linh ứng bình quân"],
  [/và nạp bản bạn đã lưu trước đó\./g, "và hồi nạp hiệu bản tiền khắc ấn."],
  [/Thiếu dữ liệu thế cờ\. Hãy quay lại gallery và mở lại\./g, "Kỳ liệu khuyết thiếu. Thỉnh hồi Kỳ Các tái khai trận."],
  [/AI chưa chắc đây là một thế cờ hợp lệ; hãy kiểm tra quân\./g, "AI vị quyết định trận thế hợp lệ; thỉnh hiệu nghiệm chư quân."],
  [/Một số ô có độ tin cậy thấp và đã được đánh dấu để kiểm tra\./g, "Nhược linh ứng vị đã được tiêu ký để hiệu nghiệm."],
  [/AI đã tự dùng tiền xử lý /g, "AI tự vận tiền xử lý "],
  [/ cho bản scan\/sách cũ\./g, " cho cổ phổ ảnh bản."],
  [/Đã khắc ấn trận thế và nhập mẫu hiệu chỉnh vào dữ liệu tu luyện local\./g, "Dĩ khắc ấn trận thế, hiệu bản nhập bản địa tu luyện kỳ liệu."],
  [/Kỳ trận #(\d+)/g, "Kỳ Trận #$1"],
  [/Trang \/ ảnh nguồn:/g, "Cổ phổ trang / nguyên đồ:"],
  [/độ tin cậy/g, "linh ứng"],
];

function translateString(input: string) {
  const direct = exactTerms.get(input.trim());
  if (direct) {
    const leading = input.match(/^\s*/)?.[0] ?? "";
    const trailing = input.match(/\s*$/)?.[0] ?? "";
    return `${leading}${direct}${trailing}`;
  }

  let output = input;
  for (const [pattern, replacement] of fragmentRules) {
    output = output.replace(pattern, replacement);
  }
  return output;
}

function translateElement(root: ParentNode) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  let node = walker.nextNode();
  while (node) {
    textNodes.push(node as Text);
    node = walker.nextNode();
  }

  for (const textNode of textNodes) {
    const parent = textNode.parentElement;
    if (!parent || parent.closest("script, style, code, pre")) continue;
    const next = translateString(textNode.data);
    if (next !== textNode.data) textNode.data = next;
  }

  const elements = root instanceof Element
    ? [root, ...Array.from(root.querySelectorAll("[title], [aria-label], [placeholder], [alt]"))]
    : Array.from(root.querySelectorAll("[title], [aria-label], [placeholder], [alt]"));

  for (const element of elements) {
    for (const attribute of ["title", "aria-label", "placeholder", "alt"]) {
      const value = element.getAttribute(attribute);
      if (!value) continue;
      const next = translateString(value);
      if (next !== value) element.setAttribute(attribute, next);
    }
  }
}

export default function HanVietMode() {
  useEffect(() => {
    document.documentElement.dataset.lexicon = "han-viet";
    translateElement(document.body);

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === "characterData" && mutation.target instanceof Text) {
          const next = translateString(mutation.target.data);
          if (next !== mutation.target.data) mutation.target.data = next;
          continue;
        }
        for (const added of mutation.addedNodes) {
          if (added instanceof Element) translateElement(added);
          else if (added instanceof Text) {
            const next = translateString(added.data);
            if (next !== added.data) added.data = next;
          }
        }
      }
    });

    observer.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
    });

    const nativeConfirm = window.confirm.bind(window);
    window.confirm = (message?: string) => nativeConfirm(translateString(String(message ?? "")));

    return () => {
      observer.disconnect();
      window.confirm = nativeConfirm;
      delete document.documentElement.dataset.lexicon;
    };
  }, []);

  return null;
}
