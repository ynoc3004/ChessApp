import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const targets = [
  path.join(root, "node_modules", "react-chessboard", "dist", "index.esm.js"),
  path.join(root, "node_modules", "react-chessboard", "dist", "index.js"),
];

let touched = 0;

for (const file of targets) {
  if (!fs.existsSync(file)) continue;

  const original = fs.readFileSync(file, "utf8");
  let next = original;

  // react-chessboard 5.12.1 forces the drag clone to snap its CENTER to the
  // pointer. On large/responsive boards this causes the piece to visibly jump
  // away from the grab point. Lichess keeps the natural grab offset instead.
  next = next.replace(
    /snapCenterToCursor\s*,\s*/g,
    "",
  );

  // 5.12.1 applies dragActivationDistance to touch/right-click sensors but not
  // MouseSensor. Patch MouseSensor to use the same activation constraint so a
  // normal click does not instantly start a mouse drag.
  next = next.replace(
    /useSensor\(MouseSensor\)(?!\s*,)/g,
    "useSensor(MouseSensor, { activationConstraint: pointerActivationConstraint })",
  );

  // Common rollup formatting variant.
  next = next.replace(
    /useSensor\(MouseSensor\s*\)/g,
    "useSensor(MouseSensor, { activationConstraint: pointerActivationConstraint })",
  );

  if (next !== original) {
    fs.writeFileSync(file, next, "utf8");
    touched += 1;
    console.log(`[patch-react-chessboard] patched ${path.basename(file)}`);
  }
}

if (touched === 0) {
  console.log(
    "[patch-react-chessboard] no changes needed (already patched or package layout changed)",
  );
}
