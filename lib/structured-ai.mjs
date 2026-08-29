const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function anthropicSchema(value) {
  if (Array.isArray(value)) return value.map(anthropicSchema);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum"].includes(key))
    .map(([key, item]) => [key, anthropicSchema(item)]));
}

function providers() {
  const available = {
    anthropic: process.env.ANTHROPIC_API_KEY ? { name: "anthropic", model: process.env.ANTHROPIC_MODEL || "claude-haiku-4-5" } : null,
    openai: process.env.OPENAI_API_KEY ? { name: "openai", model: process.env.OPENAI_VISION_MODEL || "gpt-4o" } : null
  };
  return String(process.env.AI_PROVIDER_ORDER || "anthropic,openai").split(",").map(value => available[value.trim()]).filter(Boolean);
}

export function providerSignature() {
  return providers().map(value => `${value.name}:${value.model}`).join(",") || "no-ai-provider";
}

async function anthropicRequest({ prompt, schema, image, model, maxTokens }) {
  const content = [];
  if (image) content.push({ type: "image", source: { type: "url", url: image } });
  content.push({ type: "text", text: prompt });
  return fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model, max_tokens: maxTokens, messages: [{ role: "user", content }], output_config: { format: { type: "json_schema", schema: anthropicSchema(schema.schema) } } })
  });
}

async function openaiRequest({ prompt, schema, image, model }) {
  const content = [{ type: "text", text: prompt }];
  if (image) content.push({ type: "image_url", image_url: { url: image, detail: "high" } });
  return fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, temperature: 0, response_format: { type: "json_schema", json_schema: schema }, messages: [{ role: "user", content }] })
  });
}

export async function callStructured({ prompt, schema, image, label, maxTokens = 8192 }) {
  const configured = providers();
  if (!configured.length) throw new Error("ANTHROPIC_API_KEY or OPENAI_API_KEY secret is required");
  const failures = [];
  for (const provider of configured) {
    for (let attempt = 0; attempt < 4; attempt++) {
      const response = provider.name === "anthropic"
        ? await anthropicRequest({ prompt, schema, image, model: provider.model, maxTokens })
        : await openaiRequest({ prompt, schema, image, model: provider.model });
      if ([408, 429, 500, 502, 503, 529].includes(response.status) && attempt < 3) {
        await sleep((2 ** attempt * 1500) + Math.floor(Math.random() * 500));
        continue;
      }
      if (!response.ok) {
        const detail = await response.text();
        failures.push(`${provider.name}/${provider.model}: HTTP ${response.status} ${detail}`);
        console.warn(`${label}: ${provider.name} failed, trying the next provider`);
        break;
      }
      const data = await response.json();
      const text = provider.name === "anthropic" ? data.content?.filter(value => value.type === "text").map(value => value.text).join("") : data.choices?.[0]?.message?.content;
      if (!text) { failures.push(`${provider.name}/${provider.model}: empty response`); break; }
      const usage = provider.name === "anthropic" ? data.usage : { input_tokens: data.usage?.prompt_tokens, output_tokens: data.usage?.completion_tokens };
      console.log(`${label} provider=${provider.name}, model=${provider.model}, input_tokens=${usage?.input_tokens || "unknown"}, output_tokens=${usage?.output_tokens || "unknown"}`);
      return { value: JSON.parse(text), provider: provider.name, model: provider.model };
    }
  }
  throw new Error(`${label}: all AI providers failed\n${failures.join("\n")}`);
}
