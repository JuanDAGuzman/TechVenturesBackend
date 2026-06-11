// Configuración compartida de WebAuthn (passkeys) para login del admin.
const isProd = process.env.NODE_ENV === "production";

export const rpID = process.env.WEBAUTHN_RP_ID || (isProd ? "techventuresco.com" : "localhost");
export const rpName = process.env.WEBAUTHN_RP_NAME || "TechVenturesCO Admin";

export const expectedOrigins = process.env.WEBAUTHN_ORIGIN
  ? process.env.WEBAUTHN_ORIGIN.split(",").map((s) => s.trim()).filter(Boolean)
  : isProd
    ? ["https://techventuresco.com", "https://www.techventuresco.com"]
    : ["http://localhost:5173"];
