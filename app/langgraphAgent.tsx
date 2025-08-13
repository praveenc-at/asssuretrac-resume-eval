// langgraphAgent.tsx
import { UploadedFile, EvaluationResponse } from "./types";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { ChatOpenAI } from "@langchain/openai";
import { z } from "zod";

// const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
// console.log("Using OpenAI API Key:", process.env.OPENAI_API_KEY);
// const OPENAI_API_KEY="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";
/* ---------------------------
  Helpers: read file contents (txt, pdf, docx)
  Works for File (client) or server-like objects exposing arrayBuffer()
---------------------------- */
async function readFileContent(
  file: File | { name: string; arrayBuffer: () => Promise<ArrayBuffer> }
): Promise<string> {
  const name = (file as any).name?.toLowerCase?.() || "";
  const ext = name.split(".").pop() || "";
  const arrayBuffer = await (file as any).arrayBuffer();

  if (ext === "pdf") {
    const pdfjs = await import("pdfjs-dist");
    const loadingTask = pdfjs.getDocument({ data: arrayBuffer });
    const pdf = await loadingTask.promise;
    let fullText = "";
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const strings = content.items.map((it: any) => (it.str ? it.str : ""));
      fullText += strings.join(" ") + "\n";
    }
    return fullText;
  }

  if (ext === "docx") {
    const mammoth = await import("mammoth");
    const { value } = await mammoth.extractRawText({ arrayBuffer });
    return value;
  }

  try {
    const decoder = new TextDecoder("utf-8");
    return decoder.decode(arrayBuffer);
  } catch {
    // Node-friendly fallback
    try {
      // Buffer may not exist in some environments; keep it safe
      // @ts-ignore
      if (typeof Buffer !== "undefined")
        return String(Buffer.from(arrayBuffer).toString("utf8"));
    } catch {}
    // final fallback: return empty string
    return "";
  }
}

/* ---------------------------
  Robust JSON parsing helpers
---------------------------- */
function stripCodeFences(text: string) {
  // remove ```json ... ``` or ``` ... ``` fences (first occurrence)
  return text.replace(/```(?:json)?\s*([\s\S]*?)```/i, (_m, g1) => g1).trim();
}

function tryParseJsonString(s: string | null | undefined) {
  if (!s || typeof s !== "string") return null;
  const cleaned = stripCodeFences(s).trim();
  if (!cleaned) return null;
  // Try direct parse
  try {
    return JSON.parse(cleaned);
  } catch {
    // Try to find the first JSON object/array substring
    const match = cleaned.match(/\{[\s\S]*\}|\[[\s\S]*\]/m);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        return null;
      }
    }
  }
  return null;
}

/**
 * Try to extract parsed JSON from agent.invoke() result shapes.
 * Checks structuredResponse, output/result/value fields, messages array, then regex on full string.
 */
function tryExtractJson(raw: any): any | null {
  if (!raw) return null;

  // 1) structuredResponse (or similarly named)
  const structured =
    raw.structuredResponse ??
    raw.structured_response ??
    raw.structured ??
    raw.structuredResponse?.parsed;
  if (structured) {
    if (typeof structured === "object") {
      if (structured.columns && Array.isArray(structured.columns))
        return structured;
      if (structured.candidates && Array.isArray(structured.candidates))
        return structured;
      // nested properties attempt
      const nested =
        structured.output ??
        structured.value ??
        structured.parsed ??
        structured.result ??
        structured.response;
      if (nested) {
        if (typeof nested === "string") {
          const p = tryParseJsonString(nested);
          if (p) return p;
        } else if (typeof nested === "object") {
          if (nested.columns || nested.candidates) return nested;
          return nested;
        }
      }
      // maybe structured itself serializes to JSON-like string
      try {
        const srText = JSON.stringify(structured);
        const p2 = tryParseJsonString(srText);
        if (p2) return p2;
      } catch {}
      return structured;
    } else if (typeof structured === "string") {
      const p = tryParseJsonString(structured);
      if (p) return p;
    }
  }

  // 2) common direct fields
  const candidatesFields = [
    raw.output,
    raw.result,
    raw.response,
    raw.value,
    raw.parsed,
  ];
  for (const c of candidatesFields) {
    if (!c) continue;
    if (typeof c === "object") {
      if (c.columns && Array.isArray(c.columns)) return c;
      if (c.candidates && Array.isArray(c.candidates)) return c;
      return c;
    } else if (typeof c === "string") {
      const p = tryParseJsonString(c);
      if (p) return p;
    }
  }

  // 3) Check messages array (AIMessage content often contains fenced JSON)
  if (Array.isArray(raw.messages) && raw.messages.length > 0) {
    for (let i = raw.messages.length - 1; i >= 0; i--) {
      const msg = raw.messages[i];
      if (!msg) continue;
      // Support different message shapes
      const content =
        msg.content ??
        msg.text ??
        msg?.lc_kwargs?.content ??
        (typeof msg === "string" ? msg : null);
      if (!content) continue;
      const text =
        typeof content === "string" ? content : JSON.stringify(content);
      const parsed = tryParseJsonString(text);
      if (parsed) return parsed;
    }
  }

  // 4) Overall raw string fallback
  try {
    const rawString = typeof raw === "string" ? raw : JSON.stringify(raw);
    const p = tryParseJsonString(rawString);
    if (p) return p;
  } catch {}

  return null;
}

/* ---------------------------
  1) extractOutputColumns - agent with Zod responseFormat
---------------------------- */
const OutputColumnsSchema = z.object({
  columns: z.array(z.string().min(1)).describe("List of output column names"),
});

export async function extractOutputColumns(
  evaluationCriteriaText: string,
  llmModel = "gpt-4o"
): Promise<string[]> {
  console.log("Extracting output columns...");
  // The SDK will pick API key from process.env.OPENAI_API_KEY if available in server env
  console.log("OPENAI_API_KEY:", process.env.OPENAI_API_KEY);

  const llm = new ChatOpenAI({
    model: llmModel,
    temperature: 0,
    apiKey:
      "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",
  });
  const agent = createReactAgent({
    llm,
    tools: [],
    responseFormat: OutputColumnsSchema,
  });

  const systemPrompt = `
You are ColumnExtractor — extract exact column names for an evaluation Excel from BOTH the Job Description and the Evaluation Criteria.

Rules (short):
1. Return STRICT JSON only: {"columns": ["Col_Name_One", "Col_Name_Two", ...]} — nothing else.
2. Extract columns from both sources and MERGE them. If the Evaluation Criteria contains an "Output Requirements:" section, extract exactly those items (prefer that naming). Otherwise infer from Responsibilities/Skills/Qualifications.
3. Normalize names: TitleCase words joined by underscores (Years_of_Experience, SQL_Proficiency). Remove punctuation; convert spaces to underscores.
4. Naming hints:
   - proficiency/rating: use 'SQL_Proficiency', 'Python_Proficiency' (assume 1–5).
   - years: 'AWS_Experience_Years', 'Years_of_Experience'.
   - multi-value/tool lists: 'AWS_Services, 'ETL_Tools', 'Certifications'.
   - boolean flags: 'Data_Pipeline_Experience', 'Serverless_Functions_Implemented' (true/false).
   - include 'Candidate_Name', 'Current_Role', and optionally 'Overall_Fit_Percentage'.
5. Deduplicate similar fields and order by importance (role/title first, core proficiencies next, supporting skills/certs last).
6. No explanations, no markdown, no code fences.

Make sure you extract all relevant columns from the Evaluation Criteria and Job Description. Donot just display the Evaluation Criteria columns.
Dont hallicunate or hallucinate any columns. You should extract from both the Evaluation Criteria and Job Description.

Now read the user-provided Job Description and Evaluation Criteria and return the merged columns JSON.
  `.trim();

  const userPrompt = `
Evaluation Criteria:
${evaluationCriteriaText}
  `.trim();

  let raw: any = null;
  try {
    raw = await agent.invoke({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });
  } catch (err) {
    console.warn("Agent.invoke error while extracting columns:", err);
    // fallback: direct LLM call (best-effort)
    // try {
    //   const prompt = `SYSTEM:\n${systemPrompt}\n\nUSER:\n${userPrompt}`;
    //   const llmResp = await llm.call([
    //     { role: "user", content: prompt } as any,
    //   ]);
    //   raw = llmResp;
    // } catch (e) {
    //   console.error("Direct LLM fallback during column extraction failed:", e);
    //   raw = null;
    // }
  }

  console.log("Raw agent response (extractOutputColumns):", raw);

  // Try to obtain structured parsed object
  const parsedCandidate = tryExtractJson(raw);
  if (
    parsedCandidate &&
    parsedCandidate.columns &&
    Array.isArray(parsedCandidate.columns)
  ) {
    try {
      const validated = OutputColumnsSchema.parse(parsedCandidate);
      console.log("Extracted columns (validated):", validated.columns);
      return validated.columns.map((c: any) => String(c).trim());
    } catch (zErr) {
      console.warn(
        "OutputColumns Zod parse failed after tryExtractJson:",
        zErr
      );
      // If columns array exists, coerce and return it
      if (parsedCandidate.columns && Array.isArray(parsedCandidate.columns)) {
        return parsedCandidate.columns.map((c: any) => String(c).trim());
      }
    }
  }

  console.warn(
    "Could not get structured columns from agent — falling back to heuristics."
  );

  // Heuristic fallback: parse text after "Output Requirements:"
  try {
    const lc = evaluationCriteriaText;
    const markerIdx = lc.search(/output\s+requirements\s*[:\-]/i);
    let tail = markerIdx >= 0 ? lc.slice(markerIdx) : lc;
    tail = tail.replace(/output\s+requirements\s*[:\-].*/i, "");
    const lines = tail
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    const candidateCols: string[] = [];
    for (const line of lines) {
      if (line.length > 140) break;
      const cleaned = line.replace(/^[-*•\d\.\)\s]+/, "").trim();
      const maybeField = cleaned.split(/[-–—:]/)[0].trim();
      if (
        maybeField &&
        maybeField.length < 100 &&
        maybeField.split(" ").length <= 8
      ) {
        if (
          !/[a-z]{5,}\s+[a-z]{5,}/i.test(maybeField) ||
          maybeField.split(" ").length <= 6
        ) {
          candidateCols.push(maybeField.replace(/\s+/g, "_"));
        }
      }
      if (candidateCols.length >= 40) break;
    }

    if (candidateCols.length > 0) {
      const uniq = Array.from(new Set(candidateCols));
      console.log("Fallback-extracted columns (heuristic):", uniq);
      return uniq;
    }
  } catch (e) {
    console.warn("Fallback heuristic parsing failed:", e);
  }

  // Ultimate fallback (cemented)
  const fallback = [
    "Candidate Name",
    "Current Role",
    "Years of Experience",
    "SQL Proficiency (1-5 Rating)",
    "Python Proficiency (1-5 Rating)",
    "AWS Skills",
    "AWS Experience (Years)",
    "Data Pipeline Experience",
    "Relevant Certifications",
    "Overall Fit (%)",
  ];
  console.log("Returning ultimate fallback columns:", fallback);
  return fallback;
}

/* ---------------------------
  Utilities: inference & dynamic Zod builder
---------------------------- */
function inferTypeFromColumnName(
  col: string
): "number" | "rating" | "boolean" | "array" | "string" {
  const c = col.toLowerCase();
  if (
    /\b(data pipeline|pipeline experience|etl|etl\/elt|built pipelines|pipelines|yes\/no|true\/false)\b/.test(
      c
    )
  )
    return "boolean";
  if (
    /\b(years|experience|years of experience|aws experience|experience \(years\)|duration)\b/.test(
      c
    )
  )
    return "number";
  if (/\b(overall fit|overall|match|percentage|%|percent)\b/.test(c))
    return "number";
  if (/\b(proficiency|rating|score|1-5|1 to 5|1–5)\b/.test(c)) return "rating";
  if (
    /\b(skill|skills|aws|technolog|tools|certification|certifications|certs)\b/.test(
      c
    )
  )
    return "array";
  return "string";
}

function buildCandidateZod(columns: string[]) {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const col of columns) {
    const t = inferTypeFromColumnName(col);
    if (t === "number") shape[col] = z.number().optional().default(0);
    else if (t === "rating") {
      if (col.includes("%") || col.toLowerCase().includes("percent"))
        shape[col] = z.number().min(0).max(100).optional().default(0);
      else shape[col] = z.number().min(0).max(5).optional().default(0);
    } else if (t === "boolean")
      shape[col] = z.boolean().optional().default(false);
    else if (t === "array")
      shape[col] = z.array(z.string()).optional().default([]);
    else shape[col] = z.string().optional().default("");
  }
  return z.object(shape);
}

/* ---------------------------
  2) evaluateResumesWithLangGraphAgent (main exported function)
---------------------------- */
export async function evaluateResumesWithLangGraphAgent(
  resumes: UploadedFile[],
  evaluationCriteria: string,
  jobDescription: string,
  llmModel = "gpt-4o"
): Promise<EvaluationResponse> {
  console.log("Extracting output columns from evaluation criteria...");
  const columns = await extractOutputColumns(evaluationCriteria, llmModel);
  console.log("Extracted columns:", columns);

  const CandidateZod = buildCandidateZod(columns);
  const EvalSchema = z.object({
    candidates: z.array(CandidateZod),
  });

  // Read resume texts
  const resumeReads = await Promise.all(
    resumes.map(async (r) => {
      const text = await readFileContent(r.file);
      return { id: r.id, name: r.file.name, text };
    })
  );

  // Create agent for per-resume evaluation with structured response format
  const llm = new ChatOpenAI({
    model: llmModel,
    temperature: 0,
    apiKey:
      "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",
  });
  const agent = createReactAgent({
    llm,
    tools: [],
    responseFormat: EvalSchema,
  });

  const rows: Record<string, any>[] = [];

  for (const r of resumeReads) {
    const systemPrompt = `
You are ResumeScreeningBot.
Read the job description, evaluation criteria, and the candidate resume.
Return ONLY valid JSON that matches this schema:
${EvalSchema.toString()}

Evaluate the resume and populate the fields accordingly. Use defaults for missing values (0, "", false, or []).
If Candidate Name is not present in the resume, use the file name as the candidate name.
Respond with a top-level object: { "candidates": [ { ... } ] } and nothing else.
    `.trim();

    const userPrompt = `
Evaluation Criteria:
${evaluationCriteria}

Job Description:
${jobDescription}

Resume:
${r.text}
    `.trim();

    let raw: any = null;
    try {
      raw = await agent.invoke({
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      });
      console.log("Agent.invoke successful for resume:", raw);
    } catch (err) {
      console.warn(
        "Agent.invoke failed for resume; attempting LLM fallback:",
        err
      );
      try {
        const prompt = `SYSTEM:\n${systemPrompt}\n\nUSER:\n${userPrompt}`;
        const llmResp = await llm.call([
          { role: "user", content: prompt } as any,
        ]);
        raw = llmResp;
      } catch (e) {
        raw = { error: String(e) };
      }
    }

    console.log("Raw agent response (per-resume):", raw);

    const parsed =
      tryExtractJson(raw) ??
      (raw && (raw as any).output ? (raw as any).output : null);

    if (!parsed) {
      const fallbackRow: Record<string, any> = {};
      for (const col of columns) {
        const t = inferTypeFromColumnName(col);
        fallbackRow[col] =
          t === "array"
            ? []
            : t === "boolean"
            ? false
            : t === "number" || t === "rating"
            ? 0
            : "";
      }
      if (columns.includes("Candidate Name"))
        fallbackRow["Candidate Name"] = r.name;
      fallbackRow[
        "Notes"
      ] = `Failed to parse model response. Raw snapshot: ${String(raw).slice(
        0,
        500
      )}`;
      rows.push(fallbackRow);
      continue;
    }

    // Validate with Zod
    try {
      const validated = EvalSchema.parse(parsed);
      for (const cand of validated.candidates) {
        if (
          columns.includes("Candidate Name") &&
          (!cand["Candidate Name"] ||
            String(cand["Candidate Name"]).trim() === "")
        ) {
          cand["Candidate Name"] = r.name;
        }
        rows.push(cand as Record<string, any>);
      }
    } catch (zErr) {
      console.warn(
        "Validation against EvalSchema failed; attempting normalization:",
        zErr
      );
      // best-effort normalization
      const candidateArray =
        parsed?.candidates && Array.isArray(parsed.candidates)
          ? parsed.candidates
          : Array.isArray(parsed)
          ? parsed
          : [parsed];
      for (const rawCand of candidateArray) {
        const normalized: Record<string, any> = {};
        for (const col of columns) {
          if (rawCand && Object.prototype.hasOwnProperty.call(rawCand, col)) {
            normalized[col] = rawCand[col];
          } else {
            const typ = inferTypeFromColumnName(col);
            normalized[col] =
              typ === "array"
                ? []
                : typ === "boolean"
                ? false
                : typ === "number" || typ === "rating"
                ? 0
                : "";
          }
        }
        if (
          columns.includes("Candidate Name") &&
          (!normalized["Candidate Name"] ||
            String(normalized["Candidate Name"]).trim() === "")
        ) {
          normalized["Candidate Name"] = r.name;
        }
        rows.push(normalized);
      }
    }
  } // end for resumes

  // Build excelData (stringify arrays, booleans -> Yes/No)
  const excelData = rows.map((row) => {
    const out: Record<string, any> = {};
    for (const col of columns) {
      const typ = inferTypeFromColumnName(col);
      const v = row[col];
      if (typ === "array")
        out[col] = Array.isArray(v) ? v.join("; ") : String(v ?? "");
      else if (typ === "boolean") out[col] = v ? "Yes" : "No";
      else out[col] = v ?? "";
    }
    if (row["Notes"]) out["Notes"] = row["Notes"];
    return out;
  });

  return {
    type: "tabular",
    data: rows,
    excelData,
  } as EvaluationResponse;
}
