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

function jsonResponse(body: Record<string, any>, status: number, extraHeaders: Record<string, string> = {}) {
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

function sanitizeUserId(value: unknown): string | null {
  if (value === null || value === undefined) return null;

  const str = String(value).trim();
  if (!str || str === 'null' || str === 'None' || str === 'undefined') {
    return null;
  }

  return str;
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

    const rawAudio = await request.arrayBuffer();
    const audioBuffer = Buffer.from(rawAudio);

    if (!audioBuffer || audioBuffer.length === 0) {
      return jsonResponse(
        { error: 'NO_AUDIO', message: 'No audio detected from ESP32.' },
        400
      );
    }

    // ==========================================
    // DETERMINE AUDIO FORMAT
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
    // FETCH USERS
    // ==========================================
    const { data: allUsers, error: usersError } = await supabaseAdmin
      .from('users')
      .select('id, name, age, gender');

    if (usersError) {
      console.error('Supabase users fetch error:', usersError);
      return jsonResponse(
        {
          error: 'USERS_FETCH_FAILED',
          message: usersError.message || 'Failed to load registered users.',
        },
        500
      );
    }

    const knownUsersString = JSON.stringify(allUsers || []);

    // ==========================================
    // GEMINI CALL
    // ==========================================
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.0-flash',
      generationConfig: {
        responseMimeType: 'application/json',
      },
    });

    const prompt = `
You are A.S.T.R.A, an AI medical telemetry assistant.

Registered Users:
${knownUsersString}

Current Vitals from Hardware:
- Temperature: ${temp}°C
- Heart Rate: ${bpm} BPM
- Oxygen: ${spo2}%

Tasks:
1. Identify the speaker from the audio if it reasonably matches a registered user.
2. If not confidently matched, return "Unidentified Patient" and null user id.
3. Provide a supportive, concise 2-sentence medical insight based on the vitals.
4. Do not invent a user ID.
5. Output strict JSON only.

Use exactly this JSON schema:
{
  "identified_user_id": "UUID string if matched, otherwise null",
  "identified_name": "Matched name or Unidentified Patient",
  "ai_response": "Two-sentence medical insight"
}
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

      // ==========================================
      // RATE LIMIT / QUOTA HANDLING
      // ==========================================
      if (
        message.includes('429') ||
        lower.includes('too many requests') ||
        lower.includes('quota') ||
        lower.includes('rate limit')
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

      // ==========================================
      // INVALID / EXPIRED API KEY HANDLING
      // ==========================================
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
            message: 'Gemini API key is invalid or expired. Update the Vercel environment variable.',
          },
          401
        );
      }

      // ==========================================
      // OTHER GEMINI FAILURES
      // ==========================================
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

    const safeUserId = sanitizeUserId(aiOutput.identified_user_id);

    const identifiedName =
      typeof aiOutput.identified_name === 'string' && aiOutput.identified_name.trim()
        ? aiOutput.identified_name.trim()
        : 'Unidentified Patient';

    const aiResponse =
      typeof aiOutput.ai_response === 'string' && aiOutput.ai_response.trim()
        ? aiOutput.ai_response.trim()
        : 'Telemetry recorded. Please review the patient vitals.';

    // ==========================================
    // SAVE TO DATABASE
    // ==========================================
    const { error: insertError } = await supabaseAdmin.from('health_data').insert({
      device_id: deviceId,
      user_id: safeUserId,
      temperature: temp,
      bpm,
      spo2,
      ai_response: aiResponse,
      identified_name: identifiedName,
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
    // SUCCESS RESPONSE TO ESP32
    // ==========================================
    return jsonResponse(
      {
        status: 'Success',
        message: 'Data saved to dashboard.',
        identified_name: identifiedName,
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