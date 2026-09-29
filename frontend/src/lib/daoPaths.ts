export type DaoModule = {
  title: string;
  subtitle: string;
  description: string;
  themes: string[];
  puzzleTheme: string;
};

export type DaoPath = {
  slug: string;
  name: string;
  han: string;
  epithet: string;
  intro: string;
  doctrine: string;
  modules: DaoModule[];
};

export const DAO_PATHS: DaoPath[] = [
  {
    slug: "thanh-long",
    name: "Thanh Long Đạo",
    han: "青龍",
    epithet: "Dưỡng Thế · Ngự Cục",
    intro: "Tu dưỡng toàn cục, điều vận quân lực, tích tiểu ưu mà thành đại thế.",
    doctrine: "Bất cầu nhất kích tất sát; tiên định quân vị, hậu đoạt cục thế.",
    modules: [
      { title: "Khai Mạch", subtitle: "Xuất Tử · Thông Lộ", description: "Kiến lập khai cục nguyên tắc, thông đạt quân lộ, hoàn tất xuất tử.", themes: ["Xuất tử", "Trung tâm", "Vương an"], puzzleTheme: "opening" },
      { title: "Dưỡng Khí", subtitle: "Hoạt Quân · Điều Vận", description: "Nhận diện bất hoạt chi quân, chuyển quân nhập yếu địa và tăng cường hiệp lực.", themes: ["Hoạt quân", "Quân vị", "Hiệp lực"], puzzleTheme: "quietMove" },
      { title: "Tàng Phong", subtitle: "Nhược Tử · Cải Vị", description: "Tầm nhược quân, nhược cách, bất lương tượng; cải vị trước khi khai chiến.", themes: ["Nhược quân", "Nhược cách", "Cải vị"], puzzleTheme: "hangingPiece" },
      { title: "Định Sơn", subtitle: "Tốt Cấu · Căn Cơ", description: "Tham cứu cô tốt, điệp tốt, hậu tốt, tốt liên và trường kỳ căn cơ.", themes: ["Tốt cấu", "Cô tốt", "Hậu tốt"], puzzleTheme: "advancedPawn" },
      { title: "Thừa Thế", subtitle: "Không Gian · Áp Chế", description: "Khai thác không gian, hạn chế đối phương, kiến lập tiền tiêu và xâm nhập điểm yếu.", themes: ["Không gian", "Tiền tiêu", "Áp chế"], puzzleTheme: "middlegame" },
      { title: "Hợp Cục", subtitle: "Mưu Lộ · Chuyển Ưu", description: "Từ ưu thế tĩnh chuyển thành hành động cụ thể: đổi quân, khai tuyến, xâm nhập và thu cục.", themes: ["Kế hoạch", "Đổi quân", "Chuyển ưu"], puzzleTheme: "advantage" },
    ],
  },
  {
    slug: "bach-ho",
    name: "Bạch Hổ Đạo",
    han: "白虎",
    epithet: "Sát Phạt · Đoạt Tử",
    intro: "Chuyên tu chiến thuật, cưỡng bức biến hóa, nhất kích đoạt tử và phá trận.",
    doctrine: "Kiến sát cơ nhi động; mỗi nhất cưỡng thủ đều hữu sở cầu.",
    modules: [
      { title: "Song Kích", subtitle: "Nhất Tử Song Công", description: "Nhất thủ đồng thời uy hiếp nhị mục tiêu, bức đối phương thất nhất.", themes: ["Đòn đôi", "Mã kích", "Hậu kích"], puzzleTheme: "fork" },
      { title: "Định Thân", subtitle: "Kiềm Chế · Bất Khả Động", description: "Lợi dụng vương hoặc đại tử phía hậu để định thân đối phương chi quân.", themes: ["Ghim", "Tương đối ghim", "Quá tải"], puzzleTheme: "pin" },
      { title: "Xuyên Tuyến", subtitle: "Tiền Khinh · Hậu Trọng", description: "Công kích tiền quân, bức ly tuyến để đoạt hậu phương trọng tử.", themes: ["Xiên", "Tuyến công", "Xuyên kích"], puzzleTheme: "skewer" },
      { title: "Dẫn Ly", subtitle: "Dụ Địch · Ly Vị", description: "Dẫn dụ hoặc cưỡng bức quân phòng thủ ly khai trọng yếu chi vị.", themes: ["Dẫn dụ", "Lệch hướng", "Thu hút"], puzzleTheme: "deflection" },
      { title: "Phá Hộ", subtitle: "Trừ Vệ · Khai Môn", description: "Tiêu trừ trọng yếu phòng thủ tử, khai tuyến nhập trận.", themes: ["Trừ phòng thủ", "Cản trở", "Khai tuyến"], puzzleTheme: "capturingDefender" },
      { title: "Tuyệt Sát", subtitle: "Cưỡng Biến · Định Cục", description: "Liên hoàn cưỡng thủ, sát vương hoặc đoạt đại tài liệu.", themes: ["Chiếu", "Bắt", "Uy hiếp"], puzzleTheme: "mate" },
    ],
  },
  {
    slug: "chu-tuoc",
    name: "Chu Tước Đạo",
    han: "朱雀",
    epithet: "Liệt Hỏa · Công Vương",
    intro: "Tụ quân thành thế, khai tuyến phá thành, dĩ tiên thủ thiêu tận vương thành.",
    doctrine: "Hỏa khởi vu thế; vô quân hiệp lực, bất khả vọng công.",
    modules: [
      { title: "Khai Hỏa", subtitle: "Tiên Thủ · Tạo Thế", description: "Tích lũy tiên thủ, tăng áp lực, bức đối phương nhập bị động.", themes: ["Tiên thủ", "Nhịp độ", "Áp lực"], puzzleTheme: "attackingF2F7" },
      { title: "Tụ Quân", subtitle: "Hợp Lực · Hướng Vương", description: "Điều tập hậu, xa, tượng, mã hướng vương khu trước khi khai chiến.", themes: ["Tụ quân", "Công vương", "Hiệp lực"], puzzleTheme: "kingsideAttack" },
      { title: "Hiến Tử", subtitle: "Xả Tử · Phá Thành", description: "Hiến tài liệu để phá tốt hộ vương, khai tuyến hoặc cưỡng vương ly vị.", themes: ["Hiến tử", "Phá thành", "Dẫn vương"], puzzleTheme: "sacrifice" },
      { title: "Khai Tuyến", subtitle: "Khai Lộ · Nhập Cung", description: "Khai cột, hàng, đường chéo để trọng tử xâm nhập vương khu.", themes: ["Khai cột", "Khai chéo", "Xâm nhập"], puzzleTheme: "clearance" },
      { title: "Truy Vương", subtitle: "Liên Chiếu · Bức Hành", description: "Duy trì cưỡng thủ, hạn chế thoát lộ và truy kích vương bất an.", themes: ["Liên chiếu", "Vương hành", "Phong tỏa"], puzzleTheme: "exposedKing" },
      { title: "Sát Cục", subtitle: "Kết Võng · Định Sát", description: "Nhận diện sát hình và hoàn tất công kích bằng cưỡng bức biến hóa.", themes: ["Sát hình", "Chiếu bí", "Phối hợp"], puzzleTheme: "mate" },
    ],
  },
  {
    slug: "huyen-vu",
    name: "Huyền Vũ Đạo",
    han: "玄武",
    epithet: "Cố Thủ · Quy Nguyên",
    intro: "Thủ hiểm, hóa công, giản hóa cục diện, chuyển nguy vi an rồi nhập tàn cục.",
    doctrine: "Thủ phi thoái; thủ giả đoạn đối phương chi thế, hậu cầu phản chế.",
    modules: [
      { title: "Cố Thủ", subtitle: "Trọng Điểm · Bổ Khuyết", description: "Tầm đối phương uy hiếp, gia cố trọng điểm, vô dư thủ phòng ngự.", themes: ["Phòng thủ", "Trọng điểm", "Bổ khuyết"], puzzleTheme: "defensiveMove" },
      { title: "Giải Vây", subtitle: "Hóa Công · Đổi Thế", description: "Dĩ phản kích, đổi quân hoặc trả tài liệu để tiêu giải công thế.", themes: ["Phản kích", "Đổi quân", "Giải áp"], puzzleTheme: "defensiveMove" },
      { title: "Tĩnh Hậu", subtitle: "Giản Cục · An Vương", description: "Phán đoán thời cơ đổi hậu, nhập an toàn cục diện hoặc hữu lợi tàn cục.", themes: ["Đổi hậu", "Giản hóa", "An vương"], puzzleTheme: "quietMove" },
      { title: "Tốt Tàn", subtitle: "Vương Hành · Thăng Biến", description: "Vương hoạt hóa, đối vương, thông tốt, ngoại thông tốt và thăng biến tính toán.", themes: ["Tốt tàn", "Thông tốt", "Đối vương"], puzzleTheme: "pawnEndgame" },
      { title: "Xa Tàn", subtitle: "Hoạt Xa · Đoạn Tốt", description: "Xa hoạt tính, hậu phương công tốt, cầu kiều và cơ sở xa tàn kỹ pháp.", themes: ["Xa tàn", "Hoạt xa", "Thông tốt"], puzzleTheme: "rookEndgame" },
      { title: "Quy Nguyên", subtitle: "Kỹ Pháp · Định Thắng", description: "Chuyển ưu thành thắng, hoặc thủ hòa trong thiểu tài liệu chi cục.", themes: ["Kỹ pháp", "Chuyển thắng", "Thủ hòa"], puzzleTheme: "endgame" },
    ],
  },
];

export function getDaoPath(slug: string) {
  return DAO_PATHS.find((path) => path.slug === slug);
}
