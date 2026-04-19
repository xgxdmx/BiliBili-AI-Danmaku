import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const rootDist = path.join(repoRoot, "dist");

// Verify installer was created in root dist
if (existsSync(rootDist)) {
  const files = readdirSync(rootDist);
  const installers = files.filter(f => 
    f.endsWith('.exe') || f.endsWith('.dmg') || f.endsWith('.zip') || f.endsWith('.AppImage')
  );
  if (installers.length > 0) {
    console.log(`Installer output verified in: ${rootDist}`);
    console.log(`Files: ${installers.join(', ')}`);
  } else {
    console.warn(`No installer files found in: ${rootDist}`);
    console.log(`Contents: ${files.join(', ') || '(empty)'}`);
  }
} else {
  console.warn(`Output directory not found: ${rootDist}`);
}