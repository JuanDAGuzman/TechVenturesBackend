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

  const { rows: taken } = await dbQuery(
    `SELECT
        to_char(start_time,'HH24:MI') AS start_time,
        to_char(end_time,'HH24:MI')   AS end_time
     FROM appointments
     WHERE date = $1
       AND type_code = $2
       AND status IN ('CONFIRMED', 'ATENDIDA', 'ENVIADA')
       AND start_time IS NOT NULL
       AND end_time   IS NOT NULL`,
    [date, type]
  );
  const busy = new Set(taken.map((t) => `${t.start_time}-${t.end_time}`));

  const out = [];
  const seen = new Set();
  for (const s of all) {
    const k = `${s.start}-${s.end}`;
    if (!busy.has(k) && !seen.has(k)) {
      seen.add(k);
      out.push(s);
    }
  }

  const today = dayjs().format("YYYY-MM-DD");
  if (date === today) {
    const now = dayjs().format("HH:mm");
    return {
      date,
      slots: out.filter((s) => s.end > now),
    };
  }

  return { date, slots: out };
}
