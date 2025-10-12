// workers/reminders.js
import cron from "node-cron";
import { query } from "../db.js";
import { sendMailSafe, verifySMTP } from "../services/mailer.js";
import { buildReminderEmail } from "../services/emailTemplates.js";

/**
 * Ayuda: envía recordatorios para un “bucket” de tiempo.
 * - bucket = '1h'  -> próxima hora (pero >35m para evitar tardíos)
 * - bucket = '30m' -> próximos 30 minutos
 * La consulta “reclama” (marca) y devuelve secs_left para el texto dinámico.
 */
async function claimAndSend(bucket) {
  const isHour = bucket === "1h";

  const { rows: toNotify } = await query(
    `
    WITH now_local AS (
      SELECT (now() AT TIME ZONE 'America/Bogota') AS ts
    ),
    claimed AS (
      UPDATE appointments a
         SET ${isHour ? "reminded_1h_at" : "reminded_30m_at"} = NOW()
        FROM now_local nl
       WHERE a.status     = 'CONFIRMED'
         AND a.type_code  IN ('TRYOUT','PICKUP')
         AND a.start_time IS NOT NULL
         AND a.date = (nl.ts)::date
         AND ${isHour ? "a.reminded_1h_at" : "a.reminded_30m_at"} IS NULL
         -- Ventana amplia para tolerar atrasos:
         AND (a.date::timestamp + a.start_time) BETWEEN nl.ts AND nl.ts + INTERVAL '${
           isHour ? "60 minutes" : "30 minutes"
         }'
         -- EXTRA (solo 1h): evita mandar un "1 hora" cuando ya quedan <35 min
         ${
           isHour
             ? "AND (a.date::timestamp + a.start_time) - nl.ts > INTERVAL '35 minutes'"
             : ""
         }
       RETURNING
         a.*,
         EXTRACT(EPOCH FROM ((a.date::timestamp + a.start_time) - (SELECT ts FROM now_local))) AS secs_left
    )
    SELECT * FROM claimed
    ORDER BY date, start_time
    LIMIT 50
  `
  );

  for (const appt of toNotify) {
    try {
      const minutesLeft = Math.max(0, Math.round(Number(appt.secs_left) / 60));
      const { subject, html, text } = buildReminderEmail(appt, { minutesLeft });
      sendMailSafe({ to: appt.customer_email, subject, html, text });
    } catch (e) {
      console.warn("[reminder] fallo con cita", appt.id, e.message);
      // Si quisieras reintentar en el próximo tick:
      // await query(`UPDATE appointments SET ${isHour ? "reminded_1h_at" : "reminded_30m_at"} = NULL WHERE id=$1`, [appt.id]);
    }
  }
}

export function startRemindersWorker() {
  // Verificación SMTP no bloqueante
  verifySMTP().catch(() => {});

  // Corre cada minuto
  cron.schedule("* * * * *", async () => {
    try {
      // 1 hora
      await claimAndSend("1h");
    } catch (e) {
      console.warn("[reminders][1h] error:", e.message);
    }

    try {
      // 30 minutos
      await claimAndSend("30m");
    } catch (e) {
      console.warn("[reminders][30m] error:", e.message);
    }
  });
}
