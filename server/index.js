import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { GoogleGenAI } from "@google/genai";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(cors());
// Załączniki są wysyłane jako base64. Limit 25 MB chroni Render przed zbyt dużymi żądaniami.
app.use(express.json({ limit: "25mb" }));

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const SYSTEM_INSTRUCTION = `
Zawsze odpowiadaj po polsku.
Używaj naturalnego, poprawnego języka polskiego.
Masz pamięć wcześniejszych rozmów przekazywaną przez previous_interaction_id.
Jeżeli użytkownik nawiązuje do czegoś, o czym rozmawialiście wcześniej, wykorzystaj zapamiętany kontekst.
Nie udawaj, że pamiętasz coś, czego nie ma w przekazanym kontekście.
`;

app.post("/api/chat", async (req, res) => {
  try {
    const { message, previousInteractionId, file } = req.body;
    const cleanMessage = (message || "").trim();

    if (!cleanMessage && !file) {
      return res.status(400).json({ error: "Wiadomość jest pusta." });
    }

    // Zwykły czat zachowuje dotychczasową pamięć Interactions API.
    if (!file) {
      const options = {
        model: "gemini-3.5-flash-lite",
        system_instruction: SYSTEM_INSTRUCTION,
        input: cleanMessage,
      };

      if (previousInteractionId) options.previous_interaction_id = previousInteractionId;

      let interaction;
      try {
        interaction = await ai.interactions.create(options);
      } catch (firstError) {
        if (previousInteractionId) {
          console.warn("Nie udało się kontynuować pamięci Gemini. Rozpoczynam nowy kontekst.");
          interaction = await ai.interactions.create({
            model: "gemini-3.5-flash-lite",
            system_instruction: SYSTEM_INSTRUCTION,
            input: cleanMessage,
          });
        } else {
          throw firstError;
        }
      }

      return res.json({ reply: interaction.output_text, interactionId: interaction.id });
    }

    // Analiza pliku. Obsługujemy obrazy, PDF-y oraz pliki tekstowe.
    if (!file.data || !file.mimeType || !file.name) {
      return res.status(400).json({ error: "Nieprawidłowy załącznik." });
    }

    const supported =
      file.mimeType.startsWith("image/") ||
      file.mimeType === "application/pdf" ||
      file.mimeType.startsWith("text/") ||
      ["application/json", "application/xml"].includes(file.mimeType);

    if (!supported) {
      return res.status(400).json({
        error: "Ten typ pliku nie jest jeszcze obsługiwany. Dodaj PDF, obraz, TXT, JSON, CSV lub XML.",
      });
    }

    const prompt = cleanMessage || `Przeanalizuj załączony plik „${file.name}” i opisz najważniejsze informacje.`;
    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash-lite",
      contents: [
        { inlineData: { mimeType: file.mimeType, data: file.data } },
        { text: prompt },
      ],
      config: { systemInstruction: SYSTEM_INSTRUCTION },
    });

    return res.json({ reply: response.text || "Nie udało się odczytać odpowiedzi z analizy pliku." });
  } catch (error) {
    console.error("GEMINI ERROR:", error);
    res.status(500).json({ error: "Nie udało się uzyskać odpowiedzi od Gemini." });
  }
});

app.post("/api/generate-image", async (req, res) => {
  try {
    const prompt = (req.body.prompt || "").trim();
    if (!prompt) return res.status(400).json({ error: "Opisz obraz, który mam wygenerować." });

    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
    const apiToken = process.env.CLOUDFLARE_API_TOKEN;
    if (!accountId || !apiToken) {
      return res.status(500).json({ error: "Brak konfiguracji Cloudflare Workers AI." });
    }

    // SDXL Lightning lepiej pozwala sterować zgodnością obrazu z promptem.
    // Najpierw Gemini zamienia polskie polecenie na precyzyjny prompt po angielsku.
    let imagePrompt = prompt;
    try {
      const promptResponse = await ai.models.generateContent({
        model: "gemini-3.5-flash-lite",
        contents: [{
          text: `Rewrite the following Polish image-generation request as one precise English prompt for a text-to-image model.
Preserve every important subject, object, place, brand, vehicle model, color, action and visual detail.
Do not answer the user and do not add explanations. Return only the final English image prompt.
Request: ${prompt}`
        }],
      });

      const rewritten = (promptResponse.text || "").trim();
      if (rewritten) imagePrompt = rewritten;
    } catch (promptError) {
      console.warn("IMAGE PROMPT REWRITE ERROR - używam oryginalnego promptu:", promptError);
    }

    console.log("ORYGINALNY PROMPT:", prompt);
    console.log("PROMPT DO CLOUDFLARE:", imagePrompt);

    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/@cf/bytedance/stable-diffusion-xl-lightning`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prompt: imagePrompt,
          negative_prompt: "wrong subject, unrelated scene, mountains unless requested, landscape unless requested, distorted, deformed, blurry, low quality",
          width: 1024,
          height: 1024,
          num_steps: 20,
          guidance: 9
        }),
      }
    );

    // Ten model może zwrócić bezpośrednio obraz binarny albo odpowiedź JSON.
    const contentType = response.headers.get("content-type") || "";

    if (!response.ok) {
      const errorText = await response.text();
      console.error("CLOUDFLARE IMAGE ERROR:", response.status, errorText);
      throw new Error(`Cloudflare image error ${response.status}`);
    }

    if (contentType.startsWith("image/")) {
      const imageBuffer = Buffer.from(await response.arrayBuffer());
      return res.json({
        image: `data:${contentType.split(";")[0]};base64,${imageBuffer.toString("base64")}`
      });
    }

    const data = await response.json();
    const base64Image =
      data?.result?.image ||
      data?.result?.image_b64 ||
      data?.image ||
      data?.image_b64;

    if (!base64Image) {
      console.error("CLOUDFLARE IMAGE ERROR:", data);
      throw new Error(data?.errors?.[0]?.message || "Cloudflare nie zwrócił obrazu.");
    }

    res.json({ image: `data:image/png;base64,${base64Image}` });
  } catch (error) {
    console.error("IMAGE ERROR:", error);
    res.status(500).json({ error: "Nie udało się wygenerować obrazu." });
  }
});


app.post("/api/edit-image", async (req, res) => {
  try {
    const prompt = (req.body.prompt || "").trim();
    const file = req.body.file;

    if (!prompt) {
      return res.status(400).json({ error: "Napisz, jak mam przerobić zdjęcie." });
    }

    if (!file?.data || !file?.mimeType?.startsWith("image/")) {
      return res.status(400).json({ error: "Do edycji potrzebne jest zdjęcie." });
    }

    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
    const apiToken = process.env.CLOUDFLARE_API_TOKEN;
    if (!accountId || !apiToken) {
      return res.status(500).json({ error: "Brak konfiguracji Cloudflare Workers AI." });
    }

    // Gemini przygotowuje prompt do edycji, ale ma zachować główny obiekt ze zdjęcia.
    let editPrompt = prompt;
    try {
      const promptResponse = await ai.models.generateContent({
        model: "gemini-3.5-flash-lite",
        contents: [
          { inlineData: { mimeType: file.mimeType, data: file.data } },
          {
            text: `Create one precise English image-to-image prompt based on the attached source photo and this Polish edit request:
"${prompt}"

The source photo is the visual reference. Preserve the identity, shape, proportions, colors and important visual features of the main product or subject unless the user explicitly asks to change them.
If this is an advertisement request, create an attractive commercial composition around the original product, but do not invent prices, discounts, specifications, logos or claims that the user did not provide.
Return only the final English prompt, with no explanation.`
          }
        ],
      });

      const rewritten = (promptResponse.text || "").trim();
      if (rewritten) editPrompt = rewritten;
    } catch (promptError) {
      console.warn("EDIT PROMPT REWRITE ERROR - używam oryginalnego promptu:", promptError);
    }

    console.log("PROMPT EDYCJI:", editPrompt);

    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/@cf/runwayml/stable-diffusion-v1-5-img2img`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prompt: editPrompt,
          image_b64: file.data,
          strength: 0.35,
          num_steps: 20,
          guidance: 8.5
        }),
      }
    );

    const contentType = response.headers.get("content-type") || "";

    if (!response.ok) {
      const errorText = await response.text();
      console.error("CLOUDFLARE EDIT ERROR:", response.status, errorText);
      throw new Error(`Cloudflare image edit error ${response.status}`);
    }

    if (contentType.startsWith("image/")) {
      const imageBuffer = Buffer.from(await response.arrayBuffer());
      return res.json({
        image: `data:${contentType.split(";")[0]};base64,${imageBuffer.toString("base64")}`
      });
    }

    const data = await response.json();
    const base64Image =
      data?.result?.image ||
      data?.result?.image_b64 ||
      data?.image ||
      data?.image_b64;

    if (!base64Image) {
      console.error("CLOUDFLARE EDIT ERROR:", data);
      throw new Error(data?.errors?.[0]?.message || "Cloudflare nie zwrócił edytowanego obrazu.");
    }

    res.json({ image: `data:image/png;base64,${base64Image}` });
  } catch (error) {
    console.error("EDIT IMAGE ERROR:", error);
    res.status(500).json({ error: "Nie udało się przerobić zdjęcia." });
  }
});

const distPath = path.join(__dirname, "..", "dist");
app.use(express.static(distPath));
app.get("/{*splat}", (req, res) => res.sendFile(path.join(distPath, "index.html")));
app.listen(PORT, "0.0.0.0", () => console.log(`Backend działa na porcie ${PORT}`));
