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

function createWavHeader(dataLength: number, sampleRate = 8000) {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataLength, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);   // PCM
  header.writeUInt16LE(1, 22);   // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28); // byte rate
  header.writeUInt16LE(2, 32);   // block align
  header.writeUInt16LE(16, 34);  // bits/sample
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
  return NextResponse.json(
    {
      status: 'A.S.T.R.A API is ONLINE',
      message: 'Awaiting ESP32 telemetry via POST.',
    },
    {
      status: 200,
      headers: corsHeaders(),
    }
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
      return NextResponse.json(
        { error: 'No audio detected from ESP32' },
        { status: 400, headers: corsHeaders() }
      );
    }

    // ==========================================
    // DETERMINE AUDIO FORMAT
    // ==========================================
    // Your current ESP32 sends a proper WAV file with Content-Type: audio/wav.
    // So DO NOT add another WAV header in that case.
    let audioForGemini: Buffer;
    let mimeType: string;

    if (contentType.includes('audio/wav') || looksLikeWav(audioBuffer)) {
      audioForGemini = audioBuffer;
      mimeType = 'audio/wav';
    } else {
      // Fallback for old ESP32 code that sent raw PCM
      const wavHeader = createWavHeader(audioBuffer.length, 8000);
      audioForGemini = Buffer.concat([wavHeader, audioBuffer]);
      mimeType = 'audio/wav';
    }

    // ==========================================
    // FETCH USERS
    // ==========================================
    const { data: allUsers, error: usersError } = await supabaseAdmin
      .from('users')
      .select('id, name, age, gender');

    if (usersError) {
      console.error('Supabase users fetch error:', usersError);
      return NextResponse.json(
        { error: 'Failed to load registered users' },
        { status: 500, headers: corsHeaders() }
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

      // Rate limit / quota handling
      if (
        message.includes('429') ||
        message.toLowerCase().includes('too many requests') ||
        message.toLowerCase().includes('quota') ||
        message.toLowerCase().includes('rate limit')
      ) {
        return NextResponse.json(
          {
            error: 'RATE_LIMIT',
            message: 'Gemini quota or rate limit exceeded. Retry later.',
          },
          {
            status: 429,
            headers: {
              ...corsHeaders(),
              'Retry-After': '60',
            },
          }
        );
      }

      return NextResponse.json(
        {
          error: 'GEMINI_FAILURE',
          message,
        },
        {
          status: 500,
          headers: corsHeaders(),
        }
      );
    }

    // ==========================================
    // PARSE GEMINI RESPONSE
    // ==========================================
    let rawText = result.response.text() || '';
    rawText = rawText.replace(/```json/g, '').replace(/```/g, '').trim();

    const aiOutput = safeJsonParse(rawText);

    if (!aiOutput) {
      console.error('Failed to parse Gemini JSON:', rawText);
      return NextResponse.json(
        {
          error: 'AI_OUTPUT_FORMAT_ERROR',
          raw: rawText,
        },
        {
          status: 500,
          headers: corsHeaders(),
        }
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
      return NextResponse.json(
        {
          error: 'DATABASE_INSERT_FAILED',
          message: insertError.message,
        },
        {
          status: 500,
          headers: corsHeaders(),
        }
      );
    }

    // ==========================================
    // SUCCESS RESPONSE TO ESP32
    // ==========================================
    return NextResponse.json(
      {
        status: 'Success',
        message: 'Data saved to dashboard.',
        identified_name: identifiedName,
      },
      {
        status: 200,
        headers: corsHeaders(),
      }
    );
  } catch (error: any) {
    console.error('API Error:', error);

    return NextResponse.json(
      {
        error: 'SYSTEM_ERROR',
        message: error?.message || 'System Error during API execution',
      },
      {
        status: 500,
        headers: corsHeaders(),
      }
    );
  }
}