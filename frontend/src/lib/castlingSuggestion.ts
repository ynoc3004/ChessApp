export function castlingSuggestion(placement: string): string {
  const ranks = placement.split("/");
  const pieceAt = (square: string) => {
    const rank = ranks[8 - Number(square[1])] ?? "";
    const expanded = rank.replace(/[1-8]/g, (count) => ".".repeat(Number(count)));
    return expanded[square.charCodeAt(0) - 97];
  };
  const rights: string[] = [];
  if (pieceAt("e1") === "K") {
    if (pieceAt("h1") === "R") rights.push("K");
    if (pieceAt("a1") === "R") rights.push("Q");
  }
  if (pieceAt("e8") === "k") {
    if (pieceAt("h8") === "r") rights.push("k");
    if (pieceAt("a8") === "r") rights.push("q");
  }
  return rights.join("") || "-";
}
