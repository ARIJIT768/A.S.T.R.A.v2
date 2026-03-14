import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { GoogleGenerativeAI } from '@google/generative-ai';

// ==========================================
// INITIALIZE CLIENTS
// ==========================================
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

// ==========================================
// HELPERS
// ==========================================
function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Device-Id, X-Temp, X-Bpm, X-Spo2',
  };
}

function jsonResponse(
  body: Record<string, any>,
  status: number,
  extraHeaders: Record<string, string> = {}
) {
  return NextResponse.json(body, {
    status,
    headers: {
      ...corsHeaders(),
      ...extraHeaders,
    },
  });
}

function createWavHeader(dataLength: number, sampleRate = 8000) {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataLength, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28); // byte rate
  header.writeUInt16LE(2, 32); // block align
  header.writeUInt16LE(16, 34); // bits/sample
  header.write('data', 36);
  header.writeUInt32LE(dataLength, 40);
  return header;
}

function looksLikeWav(buffer: Buffer) {
  return (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WAVE'
  );
}

function safeJsonParse(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function normalizeGeminiText(text: string) {
  return text.replace(/```json/g, '').replace(/```/g, '').trim();
}

// ==========================================
// CORS / PREFLIGHT HANDLER
// ==========================================
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: corsHeaders(),
  });
}

// ==========================================
// BROWSER TEST HANDLER
// ==========================================
export async function GET() {
  return jsonResponse(
    {
      status: 'A.S.T.R.A API is ONLINE',
      message: 'Awaiting ESP32 telemetry via POST.',
    },
    200
  );
}

// ==========================================
// MAIN ESP32 POST HANDLER
// ==========================================
export async function POST(request: NextRequest) {
  try {
    const deviceId = request.headers.get('X-Device-Id') || 'ASTRA-DEVICE-01';
    const temp = parseFloat(request.headers.get('X-Temp') || '0');
    const bpm = parseInt(request.headers.get('X-Bpm') || '0', 10);
    const spo2 = parseInt(request.headers.get('X-Spo2') || '0', 10);
    const contentType = (request.headers.get('content-type') || '').toLowerCase();

    // ==========================================
    // READ AUDIO
    // ==========================================
    const rawAudio = await request.arrayBuffer();
    const audioBuffer = Buffer.from(rawAudio);

    if (!audioBuffer || audioBuffer.length === 0) {
      return jsonResponse(
        { error: 'NO_AUDIO', message: 'No audio detected from ESP32.' },
        400
      );
    }

    if (Number.isNaN(temp) || Number.isNaN(bpm) || Number.isNaN(spo2)) {
      return jsonResponse(
        {
          error: 'INVALID_VITALS',
          message: 'Temperature, BPM, or SpO2 is missing or invalid.',
        },
        400
      );
    }

    // ==========================================
    // 60-SECOND COOLDOWN PER DEVICE
    // ==========================================
    const sixtySecondsAgo = new Date(Date.now() - 60 * 1000).toISOString();

    const { data: recentRecord, error: cooldownError } = await supabaseAdmin
      .from('health_data')
      .select('created_at')
      .eq('device_id', deviceId)
      .gte('created_at', sixtySecondsAgo)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (cooldownError) {
      console.error('Cooldown check error:', cooldownError);
      return jsonResponse(
        {
          error: 'COOLDOWN_CHECK_FAILED',
          message: cooldownError.message || 'Failed to verify device cooldown.',
        },
        500
      );
    }

    if (recentRecord) {
      return jsonResponse(
        {
          error: 'DEVICE_COOLDOWN',
          message: 'This device must wait 60 seconds before sending another reading.',
        },
        429,
        {
          'Retry-After': '60',
        }
      );
    }

    // ==========================================
    // PREPARE AUDIO FOR GEMINI
    // ==========================================
    let audioForGemini: Buffer;
    let mimeType = 'audio/wav';

    if (contentType.includes('audio/wav') || looksLikeWav(audioBuffer)) {
      audioForGemini = audioBuffer;
    } else {
      const wavHeader = createWavHeader(audioBuffer.length, 8000);
      audioForGemini = Buffer.concat([wavHeader, audioBuffer]);
    }

    // ==========================================
    // GEMINI CALL WITH AUDIO
    // ==========================================
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.0-flash',
      generationConfig: {
        responseMimeType: 'application/json',
      },
    });

    const prompt = `
You are A.S.T.R.A, an AI medical telemetry assistant.

You will receive:
1. A short patient audio clip.
2. Current vitals from hardware.

Current patient vitals:
- Temperature: ${temp}°C
- Heart Rate: ${bpm} BPM
- Oxygen Saturation: ${spo2}%

Task:
Listen to the audio only for general context such as whether the patient sounds calm, weak, uncomfortable, breathless, or unclear.
Do not identify the person.
Do not perform voice authentication.
Do not claim a diagnosis from voice alone.

Return strict JSON only using exactly this schema:
{
  "audio_summary": "One short sentence about the patient's voice/audio condition",
  "ai_response": "A supportive, concise 2-sentence medical insight using vitals plus any cautious audio observation"
}

Rules:
- Keep output short and simple.
- If audio is unclear, say so briefly.
- Do not use markdown.
- Do not add extra fields.
`.trim();

    let result;

    try {
      result = await model.generateContent([
        prompt,
        {
          inlineData: {
            data: audioForGemini.toString('base64'),
            mimeType,
          },
        },
      ]);
    } catch (geminiError: any) {
      console.error('Gemini API error:', geminiError);

      const message =
        geminiError?.message ||
        geminiError?.toString() ||
        'Unknown Gemini error';

      const lower = message.toLowerCase();

      if (
        message.includes('429') ||
        lower.includes('too many requests') ||
        lower.includes('quota') ||
        lower.includes('rate limit') ||
        lower.includes('resource_exhausted')
      ) {
        return jsonResponse(
          {
            error: 'RATE_LIMIT',
            message: 'Gemini quota or rate limit exceeded. Retry later.',
          },
          429,
          {
            'Retry-After': '60',
          }
        );
      }

      if (
        lower.includes('api key expired') ||
        lower.includes('api_key_invalid') ||
        lower.includes('api key invalid') ||
        lower.includes('please renew the api key') ||
        lower.includes('invalid api key')
      ) {
        return jsonResponse(
          {
            error: 'INVALID_GEMINI_KEY',
            message: 'Gemini API key is invalid or expired. Update Vercel environment variables.',
          },
          401
        );
      }

      return jsonResponse(
        {
          error: 'GEMINI_FAILURE',
          message,
        },
        500
      );
    }

    // ==========================================
    // PARSE GEMINI RESPONSE
    // ==========================================
    const rawText = normalizeGeminiText(result.response.text() || '');
    const aiOutput = safeJsonParse(rawText);

    if (!aiOutput) {
      console.error('Failed to parse Gemini JSON:', rawText);
      return jsonResponse(
        {
          error: 'AI_OUTPUT_FORMAT_ERROR',
          raw: rawText,
        },
        500
      );
    }

    const identifiedName = 'Unidentified Patient';

    const audioSummary =
      typeof aiOutput.audio_summary === 'string' && aiOutput.audio_summary.trim()
        ? aiOutput.audio_summary.trim()
        : 'Audio was unclear.';

    const aiResponse =
      typeof aiOutput.ai_response === 'string' && aiOutput.ai_response.trim()
        ? aiOutput.ai_response.trim()
        : 'Telemetry recorded. Please review the patient vitals.';

    // ==========================================
    // SAVE TO DATABASE
    // ==========================================
    const { error: insertError } = await supabaseAdmin.from('health_data').insert({
      device_id: deviceId,
      user_id: null,
      temperature: temp,
      bpm,
      spo2,
      ai_response: aiResponse,
      identified_name: identifiedName,
      audio_summary: audioSummary,
    });

    if (insertError) {
      console.error('Supabase insert error:', insertError);
      return jsonResponse(
        {
          error: 'DATABASE_INSERT_FAILED',
          message: insertError.message,
        },
        500
      );
    }

    // ==========================================
    // SUCCESS RESPONSE
    // ==========================================
    return jsonResponse(
      {
        status: 'Success',
        message: 'Data saved to dashboard.',
        identified_name: identifiedName,
        audio_summary: audioSummary,
        ai_response: aiResponse,
      },
      200
    );
  } catch (error: any) {
    console.error('API Error:', error);

    return jsonResponse(
      {
        error: 'SYSTEM_ERROR',
        message: error?.message || 'System Error during API execution',
      },
      500
    );
  }
}