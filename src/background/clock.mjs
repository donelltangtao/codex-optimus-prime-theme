export function hourKey(date = new Date()) {
  return String(date.getHours()).padStart(2, "0");
}

export function nextHourKey(key) {
  return String((Number(key) + 1) % 24).padStart(2, "0");
}

export function millisecondsToNextHour(date = new Date()) {
  const next = new Date(date);
  next.setHours(date.getHours() + 1, 0, 0, 0);
  return Math.max(1, next.getTime() - date.getTime());
}
