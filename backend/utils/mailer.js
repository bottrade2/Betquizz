'use strict';

const nodemailer = require('nodemailer');

const SMTP_CONFIGURED = !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);

let transporter = null;

if (SMTP_CONFIGURED) {
  transporter = nodemailer.createTransport({
    host:   process.env.SMTP_HOST,
    port:   parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_PORT === '465',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
  console.log('[Mailer] Email configurado via', process.env.SMTP_HOST);
} else {
  console.log('[Mailer] SMTP não configurado — verificação de email desativada');
}

async function sendVerificationEmail(email, username, token) {
  if (!transporter) return;
  const url = `${process.env.CLIENT_URL}/verify-email?token=${token}`;
  await transporter.sendMail({
    from:    `"BetQuizz" <${process.env.SMTP_USER}>`,
    to:      email,
    subject: 'Confirma o teu email — BetQuizz',
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto">
        <h2 style="color:#7c3aed">Bem-vindo ao BetQuizz, ${username}!</h2>
        <p>Clica no botão abaixo para confirmar o teu email e ativar a conta:</p>
        <a href="${url}" style="display:inline-block;background:#7c3aed;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:bold;margin:16px 0">
          Confirmar email
        </a>
        <p style="color:#888;font-size:13px">O link expira em 24 horas. Se não criaste esta conta, ignora este email.</p>
      </div>
    `,
  });
}

module.exports = { sendVerificationEmail, SMTP_CONFIGURED };
