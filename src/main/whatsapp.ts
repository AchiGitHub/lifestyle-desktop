import { app, shell } from 'electron'

export function hasWhatsAppDesktop(): boolean {
  return app.getApplicationNameForProtocol('whatsapp://') !== ''
}

/**
 * Opens a chat with the message typed in but not sent: staff read it and
 * press send. Uses WhatsApp Desktop when installed, otherwise WhatsApp Web.
 */
export async function openChat(phone: string, text: string): Promise<void> {
  const query = `phone=${phone}&text=${encodeURIComponent(text)}`
  await shell.openExternal(
    hasWhatsAppDesktop() ? `whatsapp://send?${query}` : `https://web.whatsapp.com/send?${query}`
  )
}
