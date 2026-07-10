import fs from "fs/promises";

const apiKey = process.env.OPENAI_API_KEY;
const model = process.env.OPENAI_TEXT_MODEL || process.env.OPENAI_VISION_MODEL || "gpt-4o-mini";
const trip = process.env.TRIP || "kyrgyzstan-2026";
const dayTag = normalizeDay(process.env.DAY_TAG || "day01");
const photosFile = process.env.PHOTOS_FILE || `data/${trip}/${dayTag}-photos.json`;
const analysisFile = process.env.ANALYSIS_FILE || `data/${trip}/${dayTag}-analysis.json`;
const contextFile = process.env.DAY_CONTEXT_FILE || `data/${trip}/${dayTag}-context.json`;
const authorNotesFile = process.env.AUTHOR_NOTES_FILE || `data/${trip}/${dayTag}-author-notes.json`;
const outFile = process.env.OUT_FILE || `data/${trip}/${dayTag}-ai-review.json`;

if (!apiKey) throw new Error("OPENAI_API_KEY secret is missing");

function normalizeDay(value){const m=String(value||"").match(/\d+/);return m?`day${String(Number(m[0])).padStart(2,"0")}`:"day01";}
async function readJson(path){return JSON.parse(await fs.readFile(path,"utf8"));}
async function readJsonIfExists(path){try{return await readJson(path);}catch(error){if(error?.code==="ENOENT")return null;throw error;}}
function extractJson(text){const c=String(text||"").trim().replace(/^```json\s*/i,"").replace(/^```\s*/i,"").replace(/```$/i,"").trim();try{return JSON.parse(c);}catch(error){const s=c.indexOf("{"),e=c.lastIndexOf("}");if(s>=0&&e>s)return JSON.parse(c.slice(s,e+1));throw error;}}

function compactAnalysis(analysis){
  return (analysis.items||[]).map(item=>({
    public_id:item.public_id,
    number:item.number,
    orientation:item.orientation,
    visual_summary:item.visual_summary,
    visible_elements:item.visible_elements,
    dominant_subject:item.dominant_subject,
    scene_type:item.scene_type,
    likely_location:item.likely_location,
    location_confidence:item.location_confidence,
    observation_confidence:item.observation_confidence,
    uncertainties:item.uncertainties,
    suggested_role:item.suggested_role,
    composition_score:item.composition_score,
    story_score:item.story_score,
    emotional_score:item.emotional_score,
    technical_score:item.technical_score,
    redundancy_risk:item.redundancy_risk,
    caption_seed:item.caption_seed,
    editor_note:item.editor_note,
    needs_fact_check:item.needs_fact_check
  }));
}

function validate(review, photos){
  const ids=new Set(photos.map(p=>p.public_id));
  if(!Array.isArray(review?.items))throw new Error("Review items missing");
  const seen=new Set();
  for(const item of review.items){
    if(!ids.has(item.public_id))throw new Error(`Unknown public_id: ${item.public_id}`);
    if(seen.has(item.public_id))throw new Error(`Duplicate public_id: ${item.public_id}`);
    seen.add(item.public_id);
    if(!["hero","story","backstage","skip"].includes(item.status))throw new Error(`Invalid status: ${item.status}`);
  }
  if(review.items.filter(i=>i.status==="hero").length!==1)throw new Error("Exactly one hero required");
  return review;
}

const photos=await readJson(photosFile);
const analysis=await readJson(analysisFile);
const context=await readJsonIfExists(contextFile);
const authorNotes=await readJsonIfExists(authorNotesFile);
if(!Array.isArray(photos)||!photos.length)throw new Error(`${photosFile} missing photos`);
if(analysis?.schema_version!==2)throw new Error(`${analysisFile} must be schema_version 2`);

const payload={trip,day:dayTag,context,author_notes:authorNotes,recommendation:analysis.recommendation||null,photos:photos.map((p,i)=>({public_id:p.public_id,number:i+1,width:p.width,height:p.height})),analysis:compactAnalysis(analysis)};
const prompt=`Ты создаёшь предварительное заполнение редактора авторского тревел-журнала.

ЖЁСТКИЕ ПРАВИЛА:
- Основа подписи — visual_summary и visible_elements.
- Нельзя противоречить наблюдаемому: зелёные луга нельзя назвать пустыней, снег нельзя игнорировать, птицу нельзя заменить пейзажем.
- likely_location можно использовать в label только при location_confidence >= 0.6.
- При низкой уверенности используй нейтральную подпись без названия места.
- Авторские заметки определяют смысл и финал, но не меняют содержание фотографии.
- Ровно 1 hero. Обычно 6-8 story. Остальные backstage или skip.
- Порядок локаций следует actual_route_order.
- Не придумывай факты.
- В note объясняй роль кадра в истории, но сначала уважай его реальное содержание.

Верни только JSON:
{
  "trip":"${trip}",
  "day":"${dayTag}",
  "status":"ai_review",
  "analysis_schema_version":2,
  "updated_at":"ISO_DATE",
  "chapter":{"title":"","subtitle":"","eyebrow":"","route_note":"","theme":"","central_thought":"","intro":"","fact_checks":[""]},
  "items":[{"public_id":"","number":1,"status":"hero|story|backstage|skip","label":"","note":""}]
}

DATA:
${JSON.stringify(payload,null,2)}`;

const response=await fetch("https://api.openai.com/v1/chat/completions",{method:"POST",headers:{"Authorization":`Bearer ${apiKey}`,"Content-Type":"application/json"},body:JSON.stringify({model,temperature:0.05,response_format:{type:"json_object"},messages:[{role:"user",content:prompt}]})});
if(!response.ok)throw new Error(`Review v2 error: ${response.status} ${await response.text()}`);
const raw=extractJson((await response.json()).choices?.[0]?.message?.content||"");
const review=validate(raw,photos);
review.trip=trip;
review.day=dayTag;
review.photos_source=photosFile;
review.analysis_source=analysisFile;
review.context_source=contextFile;
review.author_notes_source=authorNotesFile;
review.status="ai_review";
review.analysis_schema_version=2;
review.updated_at=new Date().toISOString();
await fs.mkdir(outFile.split("/").slice(0,-1).join("/")||".",{recursive:true});
await fs.writeFile(outFile,JSON.stringify(review,null,2),"utf8");
console.log(`Saved observation-grounded AI review to ${outFile}`);
