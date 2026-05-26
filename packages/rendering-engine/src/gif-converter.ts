import { exec } from 'child_process';
import { promisify } from 'util';
import { unlink } from 'fs/promises';

const execAsync = promisify(exec);

// ─────────────────────────────────────────────────────────────────
// convertWebmToGif
// Converts a Playwright-recorded WebM video to an animated GIF.
// Uses ffmpeg 2-pass palette optimization for best color quality.
//
// skipSeconds: how many seconds to trim from the start of the video.
//   This is used to skip the Tailwind CDN loading phase (~5s) so the
//   GIF starts from when the slide animation actually begins.
// fps: output GIF framerate (default 12 — good balance of size vs quality)
// scale: output width in px (height auto-scales, default 960)
// ─────────────────────────────────────────────────────────────────
export async function convertWebmToGif(
  inputPath: string,
  outputPath: string,
  skipSeconds: number = 5,
  fps: number = 12,
  scale: number = 960
): Promise<void> {
  const palettePath = inputPath.replace(/\.webm$/, '_palette.png');
  const scaleFilter = `fps=${fps},scale=${scale}:-1:flags=lanczos`;

  try {
    // Pass 1: generate optimal palette from the video (skip loading phase)
    await execAsync(
      `ffmpeg -ss ${skipSeconds} -i "${inputPath}" ` +
      `-vf "${scaleFilter},palettegen=stats_mode=diff" ` +
      `-y "${palettePath}"`
    );

    // Pass 2: encode GIF using palette with dithering
    await execAsync(
      `ffmpeg -ss ${skipSeconds} -i "${inputPath}" -i "${palettePath}" ` +
      `-vf "${scaleFilter},paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle" ` +
      `-loop 0 -y "${outputPath}"`
    );
  } finally {
    // Clean up palette temp file
    await unlink(palettePath).catch(() => {});
  }
}
