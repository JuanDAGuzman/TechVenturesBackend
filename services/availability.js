import dayjs from "dayjs";

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

function slotsFromWindow({ start_time, end_time, slot_minutes }) {
  const slots = [];
  let s = start_time;

  while (true) {
    const e = addMin(s, slot_minutes);

    if (minutesBetween(e, end_time) > 0) {
      slots.push({ start: s, end: e });
      s = e;
      continue;
    }

    if (minutesBetween(s, end_time) === slot_minutes) {
      slots.push({ start: s, end: end_time });
    }
    break;
  }

  return slots;
}

/**
 * Disponibilidad basada en availability_windows
 *
 * - Para una fecha y type_code (TRYOUT | PICKUP), buscamos TODAS las ventanas abiertas
 *   en availability_windows (funciona para cualquier día L-D).
 * - Para cada ventana, partimos en bloques del tamaño elegido (15 / 20 / 30) SIN inventar otros.
 * - Quitamos bloques que ya tienen cita (CONFIRMED o DONE o SHIPPED, o sea cualquier cosa que
 *   no esté CANCELLED).
 *
 * @param {Object} params
 * @param {(q: string, params?: any[]) => Promise<any>} params.dbQuery
 * @param {string} params.date YYYY-MM-DD
 * @param {('TRYOUT'|'PICKUP')} params.type
 */
export async function getAvailability({ dbQuery, date, type }) {
  // Buscar en availability_windows (funciona para cualquier día)
  const { rows } = await dbQuery(
    `SELECT
        to_char(start_time,'HH24:MI') AS start_time,
        to_char(end_time,'HH24:MI')   AS end_time,
        slot_minutes
     FROM availability_windows
     WHERE date = $1 AND type_code = $2
     ORDER BY start_time ASC`,
    [date, type]
  );

  const wins = rows;

  if (!wins.length) {
    return { date, slots: [] };
  }

  const allSlots = wins.flatMap((w) =>
    slotsFromWindow({
      start_time: w.start_time,
      end_time: w.end_time,
      slot_minutes: Number(w.slot_minutes),
    })
  );

  if (!allSlots.length) {
    return { date, slots: [] };
  }

  const { rows: taken } = await dbQuery(
    `SELECT
        to_char(start_time,'HH24:MI') AS start_time,
        to_char(end_time,'HH24:MI')   AS end_time
     FROM appointments
     WHERE date = $1
       AND type_code = $2
       AND status <> 'CANCELLED'
       AND start_time IS NOT NULL
       AND end_time   IS NOT NULL`,
    [date, type]
  );

  const busy = new Set(taken.map((t) => `${t.start_time}-${t.end_time}`));

  const finalSlots = [];

  for (const w of wins) {
    const parts = slotsFromWindow({
      start_time: w.start_time,
      end_time: w.end_time,
      slot_minutes: Number(w.slot_minutes),
    });

    const allFree = parts.every((p) => !busy.has(`${p.start}-${p.end}`));

    if (allFree && parts.length > 0) {
      finalSlots.push({
        start: w.start_time,
        end: w.end_time,
      });
    }
  }

  const uniq = [];
  const seen2 = new Set();
  for (const s of finalSlots) {
    const k = `${s.start}-${s.end}`;
    if (!seen2.has(k)) {
      seen2.add(k);
      uniq.push(s);
    }
  }

  return { date, slots: uniq };
}
