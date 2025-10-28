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
 * Disponibilidad basada en appt_windows
 *
 * - Para una fecha y type_code (TRYOUT | PICKUP), buscamos TODAS las ventanas abiertas
 *   en appt_windows.
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

  const out = [];
  const seen = new Set();
  for (const s of allSlots) {
    const k = `${s.start}-${s.end}`;
    if (!busy.has(k) && !seen.has(k)) {
      seen.add(k);
      out.push(s);
    }
  }

  return { date, slots: out };
}
