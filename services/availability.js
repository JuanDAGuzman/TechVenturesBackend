// backend/services/availability.js
import dayjs from "dayjs";

/* ───────── Helpers ───────── */
function minutesBetween(a, b) {
  if (!a || !b) return null;
  const [ah, am] = a.split(":").map(Number);
  const [bh, bm] = b.split(":").map(Number);
  return bh * 60 + bm - (ah * 60 + am);
}

function addMin(hhmm, mins) {
  const [H, M] = hhmm.split(":").map(Number);
  const d = dayjs()
    .hour(H)
    .minute(M)
    .second(0)
    .millisecond(0)
    .add(mins, "minute");
  return d.format("HH:mm");
}

// Genera slots discretos de tamaño fijo `slot_minutes` dentro de una ventana
function slotsFromWindow({ start_time, end_time, slot_minutes }) {
  const slots = [];
  let s = start_time;

  // Avanza en pasos exactos de slot_minutes; el último debe calzar exacto
  while (true) {
    const e = addMin(s, slot_minutes);
    // si el siguiente paso se pasa del final, cortamos
    if (minutesBetween(e, end_time) > 0) {
      slots.push({ start: s, end: e });
      s = e;
      continue;
    }
    // Caso exacto para el último bloque
    if (minutesBetween(s, end_time) === slot_minutes) {
      slots.push({ start: s, end: end_time });
    }
    break;
  }
  return slots;
}

/**
 * Obtiene disponibilidad SOLO desde appt_windows:
 * - Si no hay ventanas abiertas para ese día/tipo → 0 slots.
 * - Genera bloques del tamaño indicado en cada ventana (15/20/30).
 * - Filtra los bloques ya ocupados por citas CONFIRMED.
 *
 * @param {Object} params
 * @param {(q: string, params?: any[]) => Promise<any>} params.dbQuery
 * @param {string} params.date YYYY-MM-DD
 * @param {('TRYOUT'|'PICKUP')} params.type
 */
export async function getAvailability({ dbQuery, date, type }) {
  // 1) Ventanas abiertas para ese día/tipo
  const { rows: wins } = await dbQuery(
    `SELECT
        to_char(start_time,'HH24:MI') AS start_time,
        to_char(end_time,'HH24:MI')   AS end_time,
        slot_minutes
     FROM appt_windows
     WHERE date = $1 AND type_code = $2
     ORDER BY start_time ASC`,
    [date, type]
  );

  if (!wins.length) {
    return { date, slots: [] };
  }

  // 2) Generar todos los slots de todas las ventanas
  const all = wins.flatMap((w) =>
    slotsFromWindow({
      start_time: w.start_time,
      end_time: w.end_time,
      slot_minutes: Number(w.slot_minutes),
    })
  );

  if (!all.length) {
    return { date, slots: [] };
  }

  // 3) Citas ocupadas exactas
  const { rows: taken } = await dbQuery(
    `SELECT
        to_char(start_time,'HH24:MI') AS start_time,
        to_char(end_time,'HH24:MI')   AS end_time
     FROM appointments
     WHERE date = $1
       AND type_code = $2
       AND status = 'CONFIRMED'
       AND start_time IS NOT NULL
       AND end_time   IS NOT NULL`,
    [date, type]
  );
  const busy = new Set(taken.map((t) => `${t.start_time}-${t.end_time}`));

  // 4) Filtrar ocupados y quitar duplicados por si dos ventanas colindan
  const out = [];
  const seen = new Set();
  for (const s of all) {
    const k = `${s.start}-${s.end}`;
    if (!busy.has(k) && !seen.has(k)) {
      seen.add(k);
      out.push(s);
    }
  }

  return { date, slots: out };
}
