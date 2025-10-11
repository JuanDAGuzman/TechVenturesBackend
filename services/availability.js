// backend/services/availability.js
import dayjs from "dayjs";
import isBetween from "dayjs/plugin/isBetween.js";
dayjs.extend(isBetween);

// Genera slots [start,end) cada `minutes` min entre HH:MM y HH:MM (sin cruzar día)
function genSlots(dateStr, fromHHMM, toHHMM, minutes = 15) {
  const [fh, fm] = fromHHMM.split(":").map(Number);
  const [th, tm] = toHHMM.split(":").map(Number);
  let t = dayjs(dateStr).hour(fh).minute(fm).second(0).millisecond(0);
  const end = dayjs(dateStr).hour(th).minute(tm).second(0).millisecond(0);

  const out = [];
  while (t.isBefore(end)) {
    const s = t.format("HH:mm");
    const e = t.add(minutes, "minute").format("HH:mm");
    if (dayjs(`${dateStr} ${e}`).isAfter(end)) break;
    out.push({ start: s, end: e });
    t = t.add(minutes, "minute");
  }
  return out;
}

// Hace diff con citas ocupadas (array de {start_time,end_time})
function filterTaken(all, taken) {
  if (!taken || !taken.length) return all;
  const set = new Set(taken.map((t) => `${t.start_time}-${t.end_time}`));
  return all.filter((s) => !set.has(`${s.start}-${s.end}`));
}

export async function getAvailability({ dbQuery, date, type }) {
  const d = dayjs(date);
  const dow = d.day(); // 0=Dom, 1=Lun, … 6=Sáb
  let baseSlots = [];

  if (dow >= 1 && dow <= 5) {
    // Base L–V (si los mantienes): 15 min por defecto
    if (type === "TRYOUT") baseSlots = genSlots(date, "06:30", "07:30", 15);
    if (type === "PICKUP") baseSlots = genSlots(date, "08:00", "18:00", 15);
  } else if (dow === 6) {
    // Sábado: usar saturday_windows con slot_minutes
    const { rows: wins } = await dbQuery(
      `SELECT to_char(start_time,'HH24:MI') AS s,
              to_char(end_time,'HH24:MI')   AS e,
              COALESCE(slot_minutes,15)     AS m
         FROM saturday_windows
        WHERE date = $1
        ORDER BY start_time ASC`,
      [date]
    );
    wins.forEach((w) => {
      baseSlots.push(...genSlots(date, w.s, w.e, Number(w.m) || 15));
    });
  } else {
    baseSlots = []; // domingo
  }

  // Weekday manual windows (L–V): también con slot_minutes
  const { rows: extra } = await dbQuery(
    `SELECT to_char(start_time,'HH24:MI') AS s,
            to_char(end_time,'HH24:MI')   AS e,
            COALESCE(slot_minutes,15)     AS m
       FROM weekday_windows
      WHERE date=$1 AND type_code=$2
      ORDER BY start_time ASC`,
    [date, type]
  );
  extra.forEach((w) =>
    baseSlots.push(...genSlots(date, w.s, w.e, Number(w.m) || 15))
  );

  // Quita duplicados exactos
  const uniq = [];
  const seen = new Set();
  for (const s of baseSlots) {
    const k = `${s.start}-${s.end}`;
    if (!seen.has(k)) {
      seen.add(k);
      uniq.push(s);
    }
  }

  if (!uniq.length) return { date, slots: [] };

  const { rows: taken } = await dbQuery(
    `SELECT to_char(start_time,'HH24:MI') AS start_time,
            to_char(end_time,'HH24:MI')   AS end_time
       FROM appointments
      WHERE date=$1
        AND type_code=$2
        AND status='CONFIRMED'
        AND start_time IS NOT NULL
        AND end_time   IS NOT NULL`,
    [date, type]
  );

  const slots = filterTaken(uniq, taken);
  return { date, slots };
}
