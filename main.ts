// main.ts – Deno Deploy: solo envía el PDF por email

// import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
// import { createClient } from "jsr:@supabase/supabase-js@2";

import "https://deno.land/std@0.224.0/dotenv/load.ts";

// 🔐 Validación de entorno
const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const SENDGRID_API_KEY = Deno.env.get("SENDGRID_API_KEY");

if (!STRIPE_SECRET_KEY) {
  throw new Error("❌ Falta STRIPE_SECRET_KEY en las variables de entorno de Deno Deploy");
}
if (!SUPABASE_URL) {
  throw new Error("❌ Falta SUPABASE_URL en las variables de entorno de Deno Deploy");
}
if (!SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("❌ Falta SUPABASE_SERVICE_ROLE_KEY en las variables de entorno de Deno Deploy");
}
if (!SENDGRID_API_KEY) {
  throw new Error("❌ Falta SENDGRID_API_KEY en las variables de entorno de Deno Deploy");
}

const PDF_BUCKET = "downloads";
const PDF_PATH = "STEPPING GEMSTONES - Ideas to guide your way.pdf";

const handler = async (req: Request): Promise<Response> => {
  console.log("📥 main.ts recibió una request");

  try {
    const body = await req.json();
    const sessionId = body.session_id;

    console.log("🔄 Iniciando proceso con session_id:", sessionId);

    // 1. Validar el pago con Stripe
    const stripeRes = await fetch(`https://api.stripe.com/v1/checkout/sessions/${sessionId}`, {
      headers: {
        Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
      },
    });

    if (!stripeRes.ok) {
      const errorText = await stripeRes.text();
      console.error("❌ Error al verificar sesión con Stripe:", errorText);
      return new Response("Stripe session verification failed", { status: 500 });
    }

    const sessionData = await stripeRes.json();
    const customerEmail = sessionData.customer_details?.email;

    console.log("📧 Email del cliente:", customerEmail);
    console.log("💳 Estado del pago:", sessionData?.payment_status);

    if (!customerEmail || sessionData.payment_status !== "paid") {
      return new Response("Payment not confirmed or email not found", { status: 400 });
    }

    // 2. Crear Signed URL con llamada REST a Supabase
    const encodedPath = encodeURIComponent(PDF_PATH);
    const signedUrlRes = await fetch(
      `${SUPABASE_URL}/storage/v1/object/sign/${PDF_BUCKET}/${encodedPath}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ expiresIn: 60 * 60 }), // 1 hora
      }
    );

    if (!signedUrlRes.ok) {
      const errorText = await signedUrlRes.text();
      console.error("❌ Error generando Signed URL:", errorText);
      throw new Error("Supabase signed URL failed");
    }

    const signedUrlData = await signedUrlRes.json();
    const signedUrl = `${SUPABASE_URL}/storage/v1/${signedUrlData.signedURL}`;

    console.log("🔗 URL firmada generada:", signedUrl);

    // 3. Enviar email con SendGrid
    const emailPayload = {
      personalizations: [
        {
          to: [{ email: customerEmail }],
          subject: "📘 Your digital book is ready to download!",
        },
      ],
      from: { email: "info@bonilifecoaching.com.au", name: "Boni Life Coaching" },
      reply_to: { email: "bonilifecoaching@gmail.com.ar" },
      content: [
        {
          type: "text/html",
          value: `
          <div style="font-family: Arial, sans-serif; color: #333; padding: 20px;">
            <h2>Thank you for your purchase! 🙏</h2>
            <p>I'm thrilled to share with you my digital book <strong>"Stepping Gemstones"</strong>.</p>
            <p>I hope it brings you inspiration, clarity, and a renewed connection with yourself. 🌟</p>
            <p>
              👉 <a href="${signedUrl}" style="background: #4CAF50; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">Click here to download your book</a>
            </p>
            <p style="margin-top: 20px; font-size: 0.9em; color: #777;">
              This link will expire in 1 hour.<br>
              If you have any issues, feel free to reply to this email.
            </p>
            <br>
            <p>With gratitude,</p>
            <p><strong>Nic</strong></p>
          </div>
        `,
        },
      ],
    };

    console.log("📨 Enviando email a:", customerEmail);

    const emailRes = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SENDGRID_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(emailPayload),
    });

    if (!emailRes.ok) {
      const errorText = await emailRes.text();
      console.error("❌ SendGrid email error:", errorText);
      throw new Error(`SendGrid error: ${errorText}`);
    }

    console.log("✅ Email enviado correctamente");

    return new Response(JSON.stringify({ message: "Email sent ✅", downloadUrl: signedUrl }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error("🔥 Error en main.ts:", err);
    return new Response(`Internal error: ${(err as Error).message}`, { status: 500 });
  }
};

export default handler;
