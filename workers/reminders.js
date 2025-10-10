// workers/reminders.js
import cron from "node-cron";
import dayjs from "dayjs";
import { query } from "../db.js";
import { sendMailSafe, verifySMTP } from "../services/mailer.js";
import { buildReminderEmail } from "../services/emailTemplates.js";

export function startRemindersWorker() {
  // Verificación informativa al iniciar el worker (no bloquea)
  verifySMTP().catch(() => {});

  // cada minuto
  cron.schedule("* * * * *", async () => {
    try {
      const now = dayjs();
      const in2h = now.add(2, "hour");

      const { rows } = await query(
        `
        SELECT *
        FROM appointments
        WHERE status='CONFIRMED'
          AND (type_code='TRYOUT' OR type_code='PICKUP')
          AND start_time IS NOT NULL
          AND reminded_once_at IS NULL
          AND date = $1
          AND (to_timestamp(date || ' ' || start_time, 'YYYY-MM-DD HH24:MI')
               BETWEEN to_timestamp($2, 'YYYY-MM-DD HH24:MI')
               AND to_timestamp($3, 'YYYY-MM-DD HH24:MI'))
        LIMIT 50
        `,
        [
          now.format("YYYY-MM-DD"),
          now.format("YYYY-MM-DD HH:mm"),
          in2h.format("YYYY-MM-DD HH:mm"),
        ]
      );

      for (const appt of rows) {
        try {
          const { subject, html, text } = buildReminderEmail(appt);

          // Envío sin bloquear el loop del cron:
          // - No usamos await; si falla queda logueado en sendMailSafe.
          sendMailSafe({
            to: appt.customer_email,
            subject,
            html,
            text,
          });

          // Marcamos como recordado inmediatamente para evitar reintentos
          await query(
            `UPDATE appointments SET reminded_once_at=NOW() WHERE id=$1`,
            [appt.id]
          );
        } catch (err) {
          console.warn("[reminder] fallo con cita", appt.id, err.message);
        }
      }
    } catch (e) {
      console.warn("[reminders] error:", e.message);
    }
  });
}
