import type { EventData } from './types';

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';

export function getApiKey(): string {
  try {
    const Constants = require('expo-constants').default;
    const key =
      Constants.expoConfig?.extra?.anthropicApiKey ??
      process.env.EXPO_PUBLIC_ANTHROPIC_API_KEY ??
      '';
    return key as string;
  } catch {
    return (process.env.EXPO_PUBLIC_ANTHROPIC_API_KEY ?? '') as string;
  }
}

const EXTRACTION_PROMPT = `Extract event details from this content. Return ONLY valid JSON:
{
  "title": "event name",
  "date": "YYYY-MM-DD",
  "start_time": "HH:MM" (24h format),
  "end_time": "HH:MM" (24h format, estimate 1hr if not specified),
  "location": "venue/address or empty string",
  "description": "brief description or empty string"
}`;

function parseEventResponse(rawText: string): EventData {
  // Strip markdown fences before JSON.parse
  const cleaned = rawText
    .replace(/```json\s*/gi, '')
    .replace(/```\s*/g, '')
    .trim();

  const parsed = JSON.parse(cleaned) as EventData;

  const today = new Date().toISOString().split('T')[0];

  return {
    title: String(parsed.title || 'Untitled Event'),
    date:
      parsed.date && /^\d{4}-\d{2}-\d{2}$/.test(parsed.date)
        ? parsed.date
        : today,
    start_time:
      parsed.start_time && /^\d{2}:\d{2}$/.test(parsed.start_time)
        ? parsed.start_time
        : '12:00',
    end_time:
      parsed.end_time && /^\d{2}:\d{2}$/.test(parsed.end_time)
        ? parsed.end_time
        : '13:00',
    location: String(parsed.location || ''),
    description: String(parsed.description || ''),
  };
}

export async function extractEventFromImage(
  base64Image: string,
  apiKey: string,
): Promise<EventData> {
  const response = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-20250414',
      max_tokens: 512,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/jpeg',
                data: base64Image,
              },
            },
            {
              type: 'text',
              text: EXTRACTION_PROMPT,
            },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`API error ${response.status}: ${errorBody}`);
  }

  const data = await response.json();
  const textBlock = data.content?.find(
    (block: { type: string }) => block.type === 'text',
  );
  const rawText: string = textBlock?.text ?? '';

  return parseEventResponse(rawText);
}

export async function extractEventFromText(
  text: string,
  apiKey: string,
): Promise<EventData> {
  const response = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-20250414',
      max_tokens: 512,
      messages: [
        {
          role: 'user',
          content: `${EXTRACTION_PROMPT}\n\nContent:\n${text}`,
        },
      ],
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`API error ${response.status}: ${errorBody}`);
  }

  const data = await response.json();
  const textBlock = data.content?.find(
    (block: { type: string }) => block.type === 'text',
  );
  const rawText: string = textBlock?.text ?? '';

  return parseEventResponse(rawText);
}
