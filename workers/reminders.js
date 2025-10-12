// workers/reminders.js
import cron from "node-cron";
import { query } from "../db.js";
import { sendMailSafe, verifySMTP } from "../services/mailer.js";
import { buildReminderEmail } from "../services/emailTemplates.js";

export function startRemindersWorker() {
  // No bloquea el arranque
  verifySMTP().catch(() => {});

  // Helper: arma CTE que "reclama" filas (marca timestamp) y devuelve lote
  const claimSql = (minutes, column) => `
    WITH now_local AS (
      SELECT (now() AT TIME ZONE 'America/Bogota') AS ts
    ), claimed AS (
      UPDATE appointments a
         SET ${column} = NOW()
        FROM now_local nl
       WHERE a.status = 'CONFIRMED'
         AND a.type_code IN ('TRYOUT','PICKUP')
         AND a.start_time IS NOT NULL
         AND a.${column} IS NULL
         AND a.date = (nl.ts)::date
         AND (a.date::timestamp + a.start_time)
             BETWEEN nl.ts AND nl.ts + INTERVAL '${minutes} minutes'
       RETURNING a.*
    )
    SELECT * FROM claimed
    ORDER BY date, start_time
    LIMIT 50
  `;

  // Corre CADA MINUTO (barato: índices filtran, conexión se cierra rápido)
  cron.schedule("* * * * *", async () => {
    // 1) ~1 hora antes
    try {
      const { rows } = await query(claimSql(60, "reminded_1h_at"));
      for (const appt of rows) {
        try {
          const { subject, html, text } = buildReminderEmail(appt);
          sendMailSafe({ to: appt.customer_email, subject, html, text });
        } catch (e) {
          console.warn("[reminder 1h] fallo con cita", appt.id, e.message);
          // Opcional: desmarcar para reintentar
          // await query(`UPDATE appointments SET reminded_1h_at = NULL WHERE id=$1`, [appt.id]);
        }
      }
    } catch (e) {
      console.warn("[reminders 1h] error:", e.message);
    }

    // 2) ~30 minutos antes
    try {
      const { rows } = await query(claimSql(30, "reminded_30m_at"));
      for (const appt of rows) {
        try {
          const { subject, html, text } = buildReminderEmail(appt);
          sendMailSafe({ to: appt.customer_email, subject, html, text });
        } catch (e) {
          console.warn("[reminder 30m] fallo con cita", appt.id, e.message);
          // Opcional: desmarcar para reintentar
          // await query(`UPDATE appointments SET reminded_30m_at = NULL WHERE id=$1`, [appt.id]);
        }
      }
    } catch (e) {
      console.warn("[reminders 30m] error:", e.message);
    }
  });
}
