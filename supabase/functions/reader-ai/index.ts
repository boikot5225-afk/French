import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
  });
}

function extractJson(text: string) {
  const cleaned = text.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();
  try { return JSON.parse(cleaned); } catch {}
  const m = cleaned.match(/\{[\s\S]*\}/);
  if (m) return JSON.parse(m[0]);
  throw new Error("Model returned non-JSON text");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  try {
    const rawBody = await req.text();
    let body: any = {};
    try { body = rawBody ? JSON.parse(rawBody) : {}; }
    catch { return json({ error: "Invalid JSON body", raw: rawBody }, 400); }
    const task = String(body.task || "");
    const deepseekKey = Deno.env.get("DEEPSEEK_API_KEY");
    const openrouterKey = Deno.env.get("OPENROUTER_API_KEY");
    const key = deepseekKey || openrouterKey;
    if (!key) return json({ error: "Missing DEEPSEEK_API_KEY or OPENROUTER_API_KEY in Supabase secrets" }, 500);

    const apiUrl = deepseekKey ? "https://api.deepseek.com/chat/completions" : "https://openrouter.ai/api/v1/chat/completions";
    const model = Deno.env.get("DEEPSEEK_MODEL") || (deepseekKey ? "deepseek-chat" : "deepseek/deepseek-chat");

    let userPrompt = "";
    if (task === "reader_word") {
      userPrompt = `You are a French-Russian lexical assistant for a language reader. Analyze the selected French token in context. Return ONLY valid JSON with keys: pos (noun|verb|adjective|adverb|preposition|pronoun|other), lemma, infinitive, surface, ru, gender (m|f|), level (A1|A2|B1|B2), tense, person, number, form_note, note. Rules: if the token is a conjugated French verb form, lemma and infinitive must be the infinitive; form_note must briefly explain what the surface form is (for example: "présent, ils/elles", "participe passé", "imparfait, je/il"). If the token is a noun, give gender. If it is not a noun or verb, still give a short Russian meaning and lemma.\n\nTOKEN: ${body.word || body.surface || ""}\nCONTEXT: ${body.context || ""}`;    } else if (task === "translate_paragraph") {
      userPrompt = `Translate this French paragraph into natural Russian for comprehension. Do not explain grammar unless needed. Return ONLY valid JSON: {"ru":"..."}.

TEXT:
${body.text || ""}`;
    } else if (task === "analyze_sentence") {
      userPrompt = `Analyze the French sentence grammatically for a Russian-speaking learner.
Do NOT translate the full sentence. Do NOT split every word.
Return ONLY valid JSON:
{
  "chunks": [
    {"fr":"short meaningful chunk","role":"subject/verb/object/modifier/connector/etc","grammar":"short grammar explanation in Russian"}
  ],
  "grammar_notes": ["2-4 very short notes in Russian"]
}

Keep it very compact. Focus only on structure, verb form, agreement, pronouns, relatives (dont/que/qui/où), and what connects to what.

TEXT:
${body.text || ""}`;
    } else if (task === "generate_verb") {
      userPrompt = `Generate a complete French verb card for a Russian-speaking learner.
Return ONLY valid JSON:
{
  "inf": "infinitive",
  "meaning": "Russian meaning",
  "group": "er|ir|re|irr (exactly one of these values, no hyphen)",
  "aux": "avoir|être (exactly one of these values)",
  "pp": "participe passé",
  "conj": {
    "present": ["je","tu","il/elle","nous","vous","ils/elles forms only, no pronouns"],
    "imparfait": ["6 forms"],
    "futur": ["6 forms"],
    "plus_que_parfait": ["6 forms, auxiliary + pp"],
    "conditionnel": ["6 forms"],
    "subjonctif": ["6 forms"],
    "imperatif": ["tu/nous/vous forms only, no pronouns"],
    "passe_simple": ["6 forms"]
  },
  "examples": {
    "present": "one short French example",
    "imparfait": "one short French example",
    "futur": "one short French example",
    "passe": "one short French example",
    "conditionnel": "one short French example",
    "subjonctif": "one short French example"
  }
}
Use the infinitive if the token is a conjugated form. Always set group as exactly er, ir, re, or irr. Always set aux as exactly avoir or être. Include all requested tenses even for common verbs.
TOKEN: ${body.word || body.infinitive || body.surface || ""}
CONTEXT: ${body.context || ""}`;
    } else {
      return json({ error: "Unknown task" }, 400);
    }

    const r = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${key}`,
        ...(openrouterKey ? { "HTTP-Referer": "https://chatgpt.local", "X-Title": "An II Reader" } : {}),
      },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        max_tokens: task === "generate_verb" ? 1400 : (task === "analyze_sentence" ? 650 : 450),
        messages: [
          { role: "system", content: "Return only valid JSON. No markdown. No extra text." },
          { role: "user", content: userPrompt },
        ],
      }),
    });

    const data = await r.json().catch(() => ({}));
    if (!r.ok) return json({ error: data.error?.message || data.error || "DeepSeek request failed", detail: data }, r.status);

    const content = data.choices?.[0]?.message?.content || "";
    const parsed = extractJson(content);
    return json({ data: parsed });
  } catch (e) {
    return json({ error: e?.message || String(e) }, 500);
  }
});
