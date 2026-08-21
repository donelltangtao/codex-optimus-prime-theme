const NORMAL_CHROME_PX = 48;
const MINIMAL_CHROME_PX = 10;

function validateViewport(viewport) {
  if (viewport === null || typeof viewport !== "object" || Array.isArray(viewport)) {
    throw new TypeError("Invalid viewport");
  }
  const { width, height, devicePixelRatio } = viewport;
  if (!Number.isFinite(width) || width <= 0) throw new TypeError("Invalid viewport width");
  if (!Number.isFinite(height) || height <= 0) throw new TypeError("Invalid viewport height");
  if (!Number.isFinite(devicePixelRatio) || devicePixelRatio <= 0) {
    throw new TypeError("Invalid viewport devicePixelRatio");
  }
}

function validateBackground(background) {
  if (background === null || typeof background !== "object" || Array.isArray(background)) {
    throw new TypeError("Invalid background");
  }
  for (const field of ["positionWide", "positionStandard", "positionCompact"]) {
    if (typeof background[field] !== "string" || background[field].trim().length === 0) {
      throw new TypeError(`Invalid background ${field}`);
    }
  }
}

/**
 * Selects the image treatment and fixed chrome budget for a viewport.
 * The device-pixel ratio is validated as part of the viewport contract, but
 * breakpoints intentionally use CSS pixels so native layout space is stable.
 */
export function presentationFor(viewport, background) {
  validateViewport(viewport);
  validateBackground(background);

  const { width, height } = viewport;
  let mode;
  if (width < 900 || height < 650) mode = "compact";
  else if (width / height >= 2) mode = "ultrawide";
  else if (width >= 1600) mode = "wide";
  else mode = "standard";

  const compact = mode === "compact";
  const lowHeight = height < 650;
  const chromeDensity = compact || lowHeight ? "minimal" : "full";
  const chromePx = chromeDensity === "minimal" ? MINIMAL_CHROME_PX : NORMAL_CHROME_PX;
  const position = compact
    ? background.positionCompact
    : mode === "standard"
      ? background.positionStandard
      : background.positionWide;

  return {
    mode,
    fit: compact ? "contain" : "cover",
    position,
    chromeDensity,
    topChromePx: chromePx,
    bottomChromePx: chromePx
  };
}
