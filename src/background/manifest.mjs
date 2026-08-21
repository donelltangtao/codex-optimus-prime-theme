import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const PROJECT_VERSION = require("../../package.json").version;
const HOURS = Array.from({ length: 24 }, (_, hour) => String(hour).padStart(2, "0"));
const SAFE_AREAS = new Set(["left", "center"]);
const DOMINANT_TONES = new Set(["deep-night", "dawn", "day-command", "dusk", "night-battle"]);
const REQUIRED_FIELDS = new Set([
  "hour",
  "src",
  "focusX",
  "focusY",
  "safeArea",
  "positionWide",
  "positionStandard",
  "positionCompact",
  "overlayOpacity",
  "dominantTone",
  "checksum"
]);
const PROVISIONAL_CHECKSUM = "0".repeat(64);

function invalid(field) {
  throw new TypeError(`Invalid ${field}`);
}

function isRelativeAssetPath(value) {
  return typeof value === "string"
    && value.length > 0
    && !value.startsWith("/")
    && !value.startsWith("\\")
    && !/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(value)
    && !/^[a-zA-Z]:[\\/]/.test(value)
    && !value.split(/[\\/]+/).some((part) => part === "." || part === "..");
}

function isUnitInterval(value) {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isLocalVersion(value) {
  return typeof value === "string" && value.endsWith("-local");
}

/**
 * Parses and validates 24 local hourly background records.
 *
 * `allowProvisionalChecksums` is intentionally opt-in for local development
 * builds only; release callers must leave it disabled.
 */
export function parseManifest(value, { allowProvisionalChecksums = false, packageVersion = PROJECT_VERSION } = {}) {
  if (!Array.isArray(value) || value.length !== HOURS.length) invalid("manifest");

  const allowsProvisionalChecksums = allowProvisionalChecksums && isLocalVersion(PROJECT_VERSION) && isLocalVersion(packageVersion);

  const seenHours = new Set();
  const seenSources = new Set();
  const rows = value.map((row) => {
    if (row === null || typeof row !== "object" || Array.isArray(row)) invalid("record");
    if (Object.keys(row).length !== REQUIRED_FIELDS.size || Object.keys(row).some((field) => !REQUIRED_FIELDS.has(field))) invalid("record");
    if (!HOURS.includes(row.hour) || seenHours.has(row.hour)) invalid("hour");
    if (!isRelativeAssetPath(row.src) || seenSources.has(row.src)) invalid("src");
    if (!isUnitInterval(row.focusX)) invalid("focusX");
    if (!isUnitInterval(row.focusY)) invalid("focusY");
    if (!SAFE_AREAS.has(row.safeArea)) invalid("safeArea");
    if (!isNonEmptyString(row.positionWide)) invalid("positionWide");
    if (!isNonEmptyString(row.positionStandard)) invalid("positionStandard");
    if (!isNonEmptyString(row.positionCompact)) invalid("positionCompact");
    if (!isUnitInterval(row.overlayOpacity)) invalid("overlayOpacity");
    if (!DOMINANT_TONES.has(row.dominantTone)) invalid("dominantTone");
    if (!/^[0-9a-f]{64}$/.test(row.checksum) || (!allowsProvisionalChecksums && row.checksum === PROVISIONAL_CHECKSUM)) invalid("checksum");

    seenHours.add(row.hour);
    seenSources.add(row.src);
    return { ...row };
  });

  return rows.sort((left, right) => Number(left.hour) - Number(right.hour));
}
