import express from "express";
import {
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import { query } from "../db.js";
import { rpID, expectedOrigins } from "../lib/webauthnConfig.js";
import { setChallenge, takeChallenge } from "../lib/webauthnChallenges.js";

const router = express.Router();

// Login del admin con passkey (Windows Hello / huella / Face ID)
router.post("/options", async (req, res) => {
  const { rows } = await query("SELECT credential_id, transports FROM admin_passkeys");
  const allowCredentials = rows.map((r) => ({
    id: r.credential_id,
    transports: r.transports ? r.transports.split(",") : undefined,
  }));

  const options = await generateAuthenticationOptions({
    rpID,
    userVerification: "required",
    allowCredentials,
  });

  setChallenge("login", options.challenge);
  res.json({ ok: true, options });
});

router.post("/verify", async (req, res) => {
  const { response } = req.body || {};
  const expectedChallenge = takeChallenge("login");
  if (!expectedChallenge || !response?.id) {
    return res.status(400).json({ ok: false, error: "INVALID_REQUEST" });
  }

  const { rows } = await query(
    "SELECT * FROM admin_passkeys WHERE credential_id = $1",
    [response.id]
  );
  const passkey = rows[0];
  if (!passkey) {
    return res.status(401).json({ ok: false, error: "UNKNOWN_CREDENTIAL" });
  }

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin: expectedOrigins,
      expectedRPID: rpID,
      credential: {
        id: passkey.credential_id,
        publicKey: Buffer.from(passkey.public_key, "base64"),
        counter: Number(passkey.counter),
        transports: passkey.transports ? passkey.transports.split(",") : undefined,
      },
      requireUserVerification: true,
    });
  } catch (e) {
    console.error("[webauthn/verify]", e.message);
    return res.status(401).json({ ok: false, error: "VERIFICATION_FAILED" });
  }

  if (!verification.verified) {
    return res.status(401).json({ ok: false, error: "VERIFICATION_FAILED" });
  }

  await query(
    "UPDATE admin_passkeys SET counter = $1, last_used_at = NOW() WHERE id = $2",
    [verification.authenticationInfo.newCounter, passkey.id]
  );

  res.json({ ok: true, token: process.env.ADMIN_TOKEN });
});

export default router;
