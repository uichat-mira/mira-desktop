import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Jimp, ResizeStrategy } from "jimp";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.join(__dirname, "..");

export const CLIPPER_ICON_SIZES = [16, 32, 48, 128];

const DEFAULT_SOURCE_ICON_PATH = path.join(projectRoot, "icons", "icon_512.png");
const DEFAULT_OUTPUT_DIR = path.join(
  projectRoot,
  "mira-clipper-ext",
  "extension",
  "icons",
);

// Pending-authorization badge: keep the warm yellow dot used by the previous export.
const ATTENTION_COLOR = [0xf4, 0xc5, 0x42];
const ATTENTION_DIAMETER_RATIO = 0.1875;
const ATTENTION_YELLOW_RATIO = 0.77;

function layerPixel(bitmap, x, y, color, alpha) {
  const { data } = bitmap;
  const index = (y * bitmap.width + x) * 4;
  const destinationAlpha = data[index + 3] / 255;
  const outputAlpha = alpha + destinationAlpha * (1 - alpha);

  if (outputAlpha <= 0) {
    return;
  }

  for (let channel = 0; channel < 3; channel += 1) {
    data[index + channel] = Math.round(
      (color[channel] * alpha +
        data[index + channel] * destinationAlpha * (1 - alpha)) /
        outputAlpha,
    );
  }

  data[index + 3] = Math.round(outputAlpha * 255);
}

function drawCircle(image, centerX, centerY, radius, color) {
  const bitmap = image.bitmap;
  const samples = 4;
  const samplesPerPixel = samples * samples;
  const minX = Math.max(0, Math.floor(centerX - radius - 1));
  const maxX = Math.min(bitmap.width - 1, Math.ceil(centerX + radius + 1));
  const minY = Math.max(0, Math.floor(centerY - radius - 1));
  const maxY = Math.min(bitmap.height - 1, Math.ceil(centerY + radius + 1));

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      let covered = 0;

      for (let sampleY = 0; sampleY < samples; sampleY += 1) {
        for (let sampleX = 0; sampleX < samples; sampleX += 1) {
          const offsetX = (sampleX + 0.5) / samples;
          const offsetY = (sampleY + 0.5) / samples;
          const distanceX = x + offsetX - centerX;
          const distanceY = y + offsetY - centerY;

          if (distanceX * distanceX + distanceY * distanceY <= radius * radius) {
            covered += 1;
          }
        }
      }

      if (covered > 0) {
        layerPixel(bitmap, x, y, color, covered / samplesPerPixel);
      }
    }
  }
}

function drawAttentionBadge(image, size) {
  const outerDiameter = Math.max(
    5,
    Math.round(size * ATTENTION_DIAMETER_RATIO),
  );
  const yellowDiameter = Math.round(outerDiameter * ATTENTION_YELLOW_RATIO);
  const outerRadius = outerDiameter / 2;
  const center = size - 1 - outerRadius + 0.5;

  drawCircle(image, center, center, outerRadius, [255, 255, 255]);
  drawCircle(image, center, center, yellowDiameter / 2, ATTENTION_COLOR);
}

export async function generateClipperIcons({
  sourceIconPath = DEFAULT_SOURCE_ICON_PATH,
  outputDir = DEFAULT_OUTPUT_DIR,
} = {}) {
  if (!fs.existsSync(sourceIconPath)) {
    throw new Error(`Missing branding source icon: ${sourceIconPath}`);
  }

  const source = await Jimp.read(sourceIconPath);

  fs.mkdirSync(outputDir, { recursive: true });

  for (const size of CLIPPER_ICON_SIZES) {
    const icon = source
      .clone()
      .resize({ w: size, h: size, mode: ResizeStrategy.BICUBIC });
    const iconBuffer = await icon.getBuffer("image/png");
    fs.writeFileSync(path.join(outputDir, `icon-${size}.png`), iconBuffer);

    const attentionIcon = icon.clone();
    drawAttentionBadge(attentionIcon, size);
    const attentionBuffer = await attentionIcon.getBuffer("image/png");
    fs.writeFileSync(
      path.join(outputDir, `icon-${size}-attention.png`),
      attentionBuffer,
    );
  }

  console.log(`Generated clipper icons in ${outputDir}`);
}

const isDirectRun =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]).toLowerCase() === __filename.toLowerCase();

if (isDirectRun) {
  await generateClipperIcons();
}
