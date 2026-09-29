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
app.use(express.json());

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

const SYSTEM_INSTRUCTION = `
Zawsze odpowiadaj po polsku.
Używaj naturalnego, poprawnego języka polskiego.
Masz pamięć wcześniejszych rozmów przekazywaną przez previous_interaction_id.
Jeżeli użytkownik nawiązuje do czegoś, o czym rozmawialiście wcześniej, wykorzystaj zapamiętany kontekst.
Nie udawaj, że pamiętasz coś, czego nie ma w przekazanym kontekście.
`;

app.post("/api/chat", async (req, res) => {
  try {
    const { message, previousInteractionId } = req.body;

    if (!message || !message.trim()) {
      return res.status(400).json({
        error: "Wiadomość jest pusta.",
      });
    }

    const input = message.trim();

    const options = {
      model: "gemini-3.5-flash-lite",
      system_instruction: SYSTEM_INSTRUCTION,
      input,
    };

    if (previousInteractionId) {
      options.previous_interaction_id = previousInteractionId;
    }

    let interaction;

    try {
      interaction = await ai.interactions.create(options);
    } catch (firstError) {
      // Jeśli zapisany identyfikator wygasł lub został usunięty,
      // rozpoczynamy nowy łańcuch zamiast całkowicie blokować czat.
      if (previousInteractionId) {
        console.warn("Nie udało się kontynuować pamięci Gemini. Rozpoczynam nowy kontekst.");
        interaction = await ai.interactions.create({
          model: "gemini-3.5-flash-lite",
          system_instruction: SYSTEM_INSTRUCTION,
          input,
        });
      } else {
        throw firstError;
      }
    }

    res.json({
      reply: interaction.output_text,
      interactionId: interaction.id,
    });
  } catch (error) {
    console.error("GEMINI ERROR:", error);

    res.status(500).json({
      error: "Nie udało się uzyskać odpowiedzi od Gemini.",
    });
  }
});

// Generowanie obrazu z opisu tekstowego
app.post("/api/generate-image", async (req, res) => {
  try {
    const { prompt, aspectRatio = "1:1" } = req.body;

    if (!prompt || !prompt.trim()) {
      return res.status(400).json({ error: "Opis obrazu jest pusty." });
    }

    const allowedRatios = new Set(["1:1", "16:9", "9:16"]);
    const safeAspectRatio = allowedRatios.has(aspectRatio) ? aspectRatio : "1:1";

    const interaction = await ai.interactions.create({
      model: "gemini-3.1-flash-image",
      input: prompt.trim(),
      response_format: {
        type: "image",
        mime_type: "image/png",
        aspect_ratio: safeAspectRatio,
        image_size: "1K",
      },
    });

    if (!interaction.output_image?.data) {
      return res.status(502).json({ error: "Gemini nie zwrócił obrazu." });
    }

    res.json({
      image: `data:${interaction.output_image.mime_type || "image/png"};base64,${interaction.output_image.data}`,
    });
  } catch (error) {
    console.error("IMAGE GENERATION ERROR:", error);
    res.status(500).json({ error: "Nie udało się wygenerować obrazu." });
  }
});

// Gotowa aplikacja React
const distPath = path.join(__dirname, "..", "dist");

app.use(express.static(distPath));

app.get("/{*splat}", (req, res) => {
  res.sendFile(path.join(distPath, "index.html"));
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Backend działa na porcie ${PORT}`);
});
