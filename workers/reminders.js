// workers/reminders.js
import cron from "node-cron";
import { query } from "../db.js";
import { sendMailSafe, verifySMTP } from "../services/mailer.js";
import { buildReminderEmail } from "../services/emailTemplates.js";

export function startRemindersWorker() {
  // No bloquea el arranque si SMTP falla
  verifySMTP().catch(() => {});

  // Corre cada minuto
  cron.schedule("* * * * *", async () => {
    try {
      // -----------------------------------------------------------
      // 1) RECORDATORIO DE 1 HORA (ventana 59–60 min)
      //    - reclamamos y marcamos en la misma query (evita duplicados)
      // -----------------------------------------------------------
      const { rows: toNotify1h } = await query(`
        WITH now_local AS (
          SELECT (now() AT TIME ZONE 'America/Bogota') AS ts
        ), claimed AS (
          UPDATE appointments a
             SET reminded_1h_at = NOW()
            FROM now_local nl
           WHERE a.status = 'CONFIRMED'
             AND a.type_code IN ('TRYOUT','PICKUP')
             AND a.start_time IS NOT NULL
             AND a.reminded_1h_at IS NULL
             AND a.date = (nl.ts)::date
             AND (a.date::timestamp + a.start_time)
                 BETWEEN nl.ts + INTERVAL '59 minutes' AND nl.ts + INTERVAL '60 minutes'
           RETURNING a.*
        )
        SELECT * FROM claimed
        ORDER BY date, start_time
        LIMIT 100
      `);

      for (const appt of toNotify1h) {
        try {
          const { subject, html, text } = buildReminderEmail(appt, {
            leadMinutes: 60,
          });
          sendMailSafe({ to: appt.customer_email, subject, html, text });
        } catch (e) {
          console.warn("[reminder-1h] fallo con cita", appt.id, e.message);
          // Si deseas reintentar en el próximo tick, descomenta:
          // await query(`UPDATE appointments SET reminded_1h_at=NULL WHERE id=$1`, [appt.id]);
        }
      }

      // -----------------------------------------------------------
      // 2) RECORDATORIO DE 30 MIN (ventana 29–30 min)
      //    - idem, reclamamos y marcamos en la misma query
      //    - opcional: exige que ya se haya enviado el de 1h (quita el comentario si quieres)
      // -----------------------------------------------------------
      const { rows: toNotify30m } = await query(`
        WITH now_local AS (
          SELECT (now() AT TIME ZONE 'America/Bogota') AS ts
        ), claimed AS (
          UPDATE appointments a
             SET reminded_30m_at = NOW()
            FROM now_local nl
           WHERE a.status = 'CONFIRMED'
             AND a.type_code IN ('TRYOUT','PICKUP')
             AND a.start_time IS NOT NULL
             AND a.reminded_30m_at IS NULL
             -- AND a.reminded_1h_at IS NOT NULL  -- (opcional, garantiza orden)
             AND a.date = (nl.ts)::date
             AND (a.date::timestamp + a.start_time)
                 BETWEEN nl.ts + INTERVAL '29 minutes' AND nl.ts + INTERVAL '30 minutes'
           RETURNING a.*
        )
        SELECT * FROM claimed
        ORDER BY date, start_time
        LIMIT 100
      `);

      for (const appt of toNotify30m) {
        try {
          const { subject, html, text } = buildReminderEmail(appt, {
            leadMinutes: 30,
          });
          sendMailSafe({ to: appt.customer_email, subject, html, text });
        } catch (e) {
          console.warn("[reminder-30m] fallo con cita", appt.id, e.message);
          // Reintento opcional:
          // await query(`UPDATE appointments SET reminded_30m_at=NULL WHERE id=$1`, [appt.id]);
        }
      }
    } catch (e) {
      console.warn("[reminders] error:", e.message);
    }
  });
}
