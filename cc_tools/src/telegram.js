export async function sendTelegram(config, text, options = {}) {
  if (!config.telegram.enabled || !config.telegram.botToken || !config.telegram.chatId) {
    return { sent: false, message: 'Telegram no configurado.' };
  }

  const url = `https://api.telegram.org/bot${config.telegram.botToken}/sendMessage`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: config.telegram.chatId,
      text,
      parse_mode: options.parseMode,
      disable_web_page_preview: true
    })
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.ok === false) {
    throw new Error(body.description || `Telegram respondió con HTTP ${response.status}`);
  }
  return { sent: true };
}
