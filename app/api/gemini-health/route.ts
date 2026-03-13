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

    // ==========================================
    // OPTIONAL AUDIO READ (ONLY TO VALIDATE PRESENCE)
    // Gemini will NOT use audio anymore
    // ==========================================
    const rawAudio = await request.arrayBuffer();
    const audioBuffer = Buffer.from(rawAudio);

    if (!audioBuffer || audioBuffer.length === 0) {
      return jsonResponse(
        { error: 'NO_AUDIO', message: 'No audio detected from ESP32.' },
        400
      );
    }

    // ==========================================
    // BASIC VITAL VALIDATION
    // ==========================================
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
    // GEMINI CALL (TEXT-ONLY, NO AUDIO)
    // ==========================================
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.0-flash',
      generationConfig: {
        responseMimeType: 'application/json',
      },
    });

    const prompt = `
You are A.S.T.R.A, an AI medical telemetry assistant.

Current patient vitals:
- Temperature: ${temp}°C
- Heart Rate: ${bpm} BPM
- Oxygen Saturation: ${spo2}%

Task:
Return strict JSON only using exactly this schema:
{
  "ai_response": "A supportive, concise 2-sentence medical insight"
}

Rules:
- Keep the response short and clear.
- Mention if any vital appears abnormal.
- Do not identify any user.
- Do not use markdown.
- Do not include any extra fields.
`.trim();

    let result;

    try {
      result = await model.generateContent(prompt);
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