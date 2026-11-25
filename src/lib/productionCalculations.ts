export type LoadState = "unknown" | "no_team" | "over" | "available";

export function loadSummary(load: number, capacity: number, unknown = false) {
  const state: LoadState = unknown
    ? "unknown"
    : capacity <= 0
      ? "no_team"
      : load > capacity
        ? "over"
        : "available";
  return {
    state,
    percent: capacity > 0 ? Math.round((load / capacity) * 100) : null,
    balance: capacity - load,
  };
}

export function hoursLabel(minutes: number) {
  const rounded = Math.round(minutes);
  return `${Math.floor(rounded / 60)}h${String(rounded % 60).padStart(2, "0")}`;
}

export type CapacityPerson = { id: string; stage: string; minutes: number };
export type CapacityStage = { stage: string; minutesPerUnit: number | null };

export function usefulMinutes(hours: number, pauseMinutes: number, days: number) {
  if (
    ![hours, pauseMinutes, days].every(Number.isFinite) ||
    hours < 0 ||
    pauseMinutes < 0 ||
    days < 1 ||
    !Number.isInteger(days) ||
    pauseMinutes > hours * 60
  )
    return null;
  return (hours * 60 - pauseMinutes) * days;
}

/** Labour capacity, not an automatic calendar schedule. A person has one allocation. */
export function calculateCapacity(
  stages: CapacityStage[],
  people: CapacityPerson[],
  quantity: number,
) {
  const invalid =
    !Number.isInteger(quantity) ||
    quantity < 1 ||
    people.some((p) => !Number.isFinite(p.minutes) || p.minutes < 0) ||
    stages.some(
      (s) =>
        s.minutesPerUnit !== null && (!Number.isFinite(s.minutesPerUnit) || s.minutesPerUnit <= 0),
    );
  const duplicatePeople = new Set(people.map((p) => p.id)).size !== people.length;
  const rows = stages.map((s) => {
    const available = people
      .filter((p) => p.stage === s.stage)
      .reduce((sum, p) => sum + p.minutes, 0);
    const needed = s.minutesPerUnit === null ? null : s.minutesPerUnit * quantity;
    const units = s.minutesPerUnit === null ? null : Math.floor(available / s.minutesPerUnit);
    return { ...s, available, needed, units, balance: needed === null ? null : available - needed };
  });
  const complete =
    !invalid && !duplicatePeople && stages.length > 0 && rows.every((r) => r.needed !== null);
  return {
    invalid,
    duplicatePeople,
    complete,
    rows,
    units: complete ? Math.min(...rows.map((r) => r.units ?? 0)) : null,
    needed: complete ? rows.reduce((sum, r) => sum + (r.needed ?? 0), 0) : null,
    available: rows.reduce((sum, r) => sum + r.available, 0),
  };
}
