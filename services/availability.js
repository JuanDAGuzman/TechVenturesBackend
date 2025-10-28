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
  const out = [];
  let cursor = start_time;

  while (true) {
    const next = addMin(cursor, slot_minutes);

    if (minutesBetween(next, end_time) > 0) {
      out.push({ start: cursor, end: next });
      cursor = next;
      continue;
    }

    if (minutesBetween(cursor, end_time) === slot_minutes) {
      out.push({ start: cursor, end: end_time });
    }

    break;
  }

  return out;
}

export async function getAvailability({ dbQuery, date, type }) {
  const { rows: wins } = await dbQuery(
    `SELECT
        to_char(start_time,'HH24:MI') AS start_time,
        to_char(end_time,'HH24:MI')   AS end_time,
        slot_minutes
     FROM appt_windows
     WHERE date = $1
       AND type_code = $2
     ORDER BY start_time ASC`,
    [date, type]
  );

  if (!wins.length) {
    return { date, slots: [] };
  }

  let generated = [];
  for (const w of wins) {
    const mins = Number(w.slot_minutes);
    generated = generated.concat(
      slotsFromWindow({
        start_time: w.start_time,
        end_time: w.end_time,
        slot_minutes: mins,
      })
    );
  }

  if (!generated.length) {
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

  const busyKeys = new Set(taken.map((t) => `${t.start_time}-${t.end_time}`));

  const dedup = new Set();
  const available = [];
  for (const s of generated) {
    const k = `${s.start}-${s.end}`;
    if (busyKeys.has(k)) continue;
    if (dedup.has(k)) continue;
    dedup.add(k);
    available.push(s);
  }

  const todayStr = dayjs().format("YYYY-MM-DD");
  let finalSlots = available;

  if (date === todayStr) {
    const nowHHMM = dayjs().format("HH:mm");
    finalSlots = available.filter((slot) => slot.end > nowHHMM);
  }

  finalSlots.sort((a, b) =>
    a.start < b.start ? -1 : a.start > b.start ? 1 : 0
  );

  return { date, slots: finalSlots };
}
