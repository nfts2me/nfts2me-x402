const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const TELEGRAM_THREAD_ID = process.env.TELEGRAM_THREAD_ID;

async function safeFetchJson(url: string, init: RequestInit) {
    const res = await fetch(url, init);
    // Telegram puede devolver JSON, pero no queremos fallar por parseo.
    try {
        return await res.json();
    } catch {
        return { ok: res.ok, status: res.status };
    }
}

/**
 * Envía un mensaje al canal/grupo de Telegram configurado vía env vars.
 * Nunca lanza: si falta config o falla Telegram, solo hace `console.warn`.
 */
export async function sendTelegramMessage(message: string): Promise<boolean> {
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
        console.warn(
            "[telegram] Missing TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID; skipping alert.",
        );
        return false;
    }

    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;

    const payload: Record<string, unknown> = {
        chat_id: TELEGRAM_CHAT_ID,
        text: message,
        disable_web_page_preview: true,
    };
    const threadId = Number(TELEGRAM_THREAD_ID);
    if (Number.isFinite(threadId) && threadId > 0) {
        payload.message_thread_id = threadId;
    }

    try {
        const data = await safeFetchJson(url, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(payload),
        });
        if (data && typeof data === "object" && "ok" in data && data.ok === false) {
            console.warn("[telegram] Telegram API returned ok=false:", data);
            return false;
        }
        return true;
    } catch (err) {
        console.warn("[telegram] Failed to send message:", err);
        return false;
    }
}

