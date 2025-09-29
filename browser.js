import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const DOC_NAME = "gloss-1k.json";

// Models to review
let TO_REVIEW = [];

// Speech synthesis voices
let englishVoice = null;
let japaneseVoice = null;
const synth = window.speechSynthesis;

// Array of English/Japanese sentence pairs
let sentences = null;

document.addEventListener("DOMContentLoaded", () => {
  // Don't let this leak into global scope
  const supabase = createClient(
    "https://jjmuoksvuqkmoelmkkzt.supabase.co",
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpqbXVva3N2dXFrbW9lbG1ra3p0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTg5NDQyMTIsImV4cCI6MjA3NDUyMDIxMn0.wYkxPxckAlX1OzImJdUjvGoZ7S6NO62xE2bzMRTMUxw"
  );
  initializeVoices();
  window.speechSynthesis.onvoiceschanged = () => {
    initializeVoices();
  };

  (async () => {
    const { data, error } = await supabase.auth.getUser();
    if (data?.user && !error) {
      hideSignIn();
      loadTable(supabase);
    }
  })();

  document
    .querySelector("form#signin")
    ?.addEventListener("submit", async (e) => {
      e?.preventDefault();

      const email = document.querySelector("input#email").value;
      const password = document.querySelector("input#password").value;

      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (!error) {
        hideSignIn();
        loadTable(supabase);
      }
    });

  document
    .querySelector("button#review-button")
    ?.addEventListener("click", async () => {
      if (TO_REVIEW.length === 0) {
        await fetchModelsToReview(supabase);
      }
      if (TO_REVIEW.length > 0) {
        // Sometimes pick the oldest-due card;
        // Sometimes pick a English to Japanese card from the top 10.
        // Sometimes pick any card from the list.
        const rand = Math.random();
        const toReview =
          (rand < 0.33
            ? TO_REVIEW[0]
            : rand < 0.8
            ? randElement(
                TO_REVIEW.filter(
                  (o, i) => i < 10 && o.direction_ident === "en-ja"
                )
              )
            : randElement(TO_REVIEW)) || TO_REVIEW[0];

        renderReview(supabase, toReview.card_ident, toReview.direction_ident);
      }
    });
});

const notify = (messageOrFunction, timeoutMs) => {
  const container = document.querySelector("#notifications");
  if (!container) return;

  const notif = document.createElement("div");
  if (typeof messageOrFunction === "string") {
    notif.textContent = messageOrFunction;
  } else if (typeof messageOrFunction === "function") {
    messageOrFunction(notif);
  }
  container.appendChild(notif);

  let timer = null;
  if (timeoutMs > 0) {
    timer = setTimeout(() => notif.remove(), timeoutMs);
  }

  return () => {
    if (timer) clearTimeout(timer);
    notif.remove();
  };
};

const renderReview = (supabase, id, direction) => {
  const reviewArea = document.querySelector("#review-area");
  const row = sentences?.[Number(id)];
  if (!reviewArea || !row) return;

  reviewArea.classList.remove("hidden");
  const quizStart = Date.now();

  const playQuestion = () => {
    synth.cancel();
    if (direction === "en-ja") speakEnglish(row.en);
    else speakJapanese(row.ja);
  };
  const playAnswer = () => {
    synth.cancel();
    if (direction === "ja-en") speakEnglish(row.en);
    else speakJapanese(row.ja);
  };

  playQuestion();

  const inputForm = document.createElement("form");
  inputForm.classList.add("quiz-input");

  const replayButton = document.createElement("button");
  replayButton.type = "button";
  replayButton.textContent = "Replay";
  replayButton.addEventListener("click", playQuestion);
  inputForm.appendChild(replayButton);

  const input = document.createElement("input");
  input.type = "text";
  input.placeholder =
    direction === "en-ja" ? "Type the Japanese here" : "Type the English here";
  inputForm.appendChild(input);

  const submitQuizButton = document.createElement("button");
  submitQuizButton.type = "submit";
  submitQuizButton.textContent = "Submit";
  inputForm.appendChild(submitQuizButton);

  const answerSection = document.createElement("div");
  answerSection.classList.add("answer-section");
  answerSection.classList.add("hidden");

  const userAnswer = document.createElement("h3");
  answerSection.appendChild(userAnswer);
  // this will eventually contain the answer they typed in

  const expectedAnswer = document.createElement("h2");
  expectedAnswer.textContent = direction === "en-ja" ? row.ja : row.en;
  answerSection.appendChild(expectedAnswer);

  const yesButton = document.createElement("button");
  yesButton.textContent = "I was correct";
  yesButton.setAttribute("data-yes", "");
  answerSection.appendChild(yesButton);

  const noButton = document.createElement("button");
  noButton.textContent = "I was wrong";
  noButton.setAttribute("data-no", "");
  answerSection.appendChild(noButton);

  const replay = document.createElement("button");
  replay.textContent = "Replay";
  replay.addEventListener("click", playAnswer);
  answerSection.appendChild(replay);

  inputForm.addEventListener("submit", async (e) => {
    e?.preventDefault();
    const answer = input.value.trim();
    if (!answer) return;

    playAnswer();
    userAnswer.textContent = answer;
    inputForm.classList.add("hidden");
    answerSection.classList.remove("hidden");
  });

  const yesNoHandler = async (e) => {
    const quizDurationMs = Date.now() - quizStart;
    const otherDirection = direction === "en-ja" ? "ja-en" : "en-ja";

    const isYes = e.target.hasAttribute("data-yes");
    const cleanupSavingNotif = notify(`Saving…`, 0);

    // First, update the model
    {
      const thisUpdate = await supabase.rpc("update_leiter_model", {
        p_document_ident: DOC_NAME,
        p_card_ident: `${id}`,
        p_is_correct: isYes ? 1 : -1,
        p_direction_ident: direction,
      });
      if (thisUpdate.error) {
        notify("⚠️ Error saving this review, please try again.");
        cleanupSavingNotif();
        return;
      }

      const otherUpdate = await supabase.rpc("update_leiter_model", {
        p_document_ident: DOC_NAME,
        p_card_ident: `${id}`,
        p_is_correct: 0, // not graded, but "passively" reviewed
        p_direction_ident: otherDirection,
      });
      if (otherUpdate.error) {
        notify("⚠️ Error saving partner review, please try again.");
        cleanupSavingNotif();
        return;
      }
    }

    // Now create the quiz records
    const reviewUpdate = await supabase.from("reviews").insert({
      document_ident: DOC_NAME,
      card_ident: `${id}`,
      direction_ident: direction,
      result: {
        v: 0,
        type: "review",
        input: input.value.trim(),
        inputMime: "text/plain",
        result: isYes,
        // perhaps useful metadata
        grader: "self",
        modality: "text",
        quizDurationMs,
        passiveDirections: [otherDirection],
      },
    });

    cleanupSavingNotif();
    if (reviewUpdate.error) {
      notify("❓ Error saving quiz details, but continuing.", 5000);
    } else {
      notify("✅ Saved!", 1000);
    }

    TO_REVIEW = TO_REVIEW.filter((o) => o.card_ident !== id);
    if (TO_REVIEW.length > 0) {
      renderReview(
        supabase,
        TO_REVIEW[0].card_ident,
        TO_REVIEW[0].direction_ident
      );
    } else {
      reviewArea.classList.add("hidden");
    }
  };

  noButton.addEventListener("click", yesNoHandler);
  yesButton.addEventListener("click", yesNoHandler);

  reviewArea.replaceChildren(inputForm, answerSection);
};

const fetchModelsToReview = async (supabase) => {
  const { data, error } = await supabase
    .from("memory")
    .select("card_ident, direction_ident, model")
    .eq("document_ident", DOC_NAME)
    .not("model->>dueMs", "is", null)
    .order("model->>dueMs", { ascending: true })
    .limit(10);
  if (data) {
    TO_REVIEW = data;
  }
};

const initializeVoices = () => {
  const voices = synth.getVoices();
  const japaneseVoices = voices.filter((o) => o.lang.startsWith("ja"));
  const englishVoices = voices.filter((o) => o.lang.startsWith("en"));

  japaneseVoice =
    japaneseVoices.find((o) => o.name.includes("Otoya")) ||
    japaneseVoices.find((o) => o.name.includes("Hattori")) ||
    japaneseVoices.find((o) => o.name.includes("O-Ren")) ||
    japaneseVoices.find(
      (o) => o.name.includes("Kyoko") && o.name.includes("Enhanced")
    ) ||
    japaneseVoices.find((o) => o.name.includes("Kyoko")) ||
    japaneseVoices[0] ||
    null;

  const samantha = englishVoices.find((o) => o.name === "Samantha");
  if (samantha) englishVoice = samantha;
};

const hideSignIn = () => {
  document.querySelector("form#signin")?.classList.add("signed-in");
};

const loadTable = async (supabase) => {
  const { data, error } = await supabase.storage
    .from("documents")
    .download(DOC_NAME);
  if (data) {
    sentences = JSON.parse(await data.text());
    renderTable(supabase, sentences);

    const selectedData = await supabase
      .from("memory")
      .select("card_ident")
      .eq("document_ident", DOC_NAME); // no DISTINCT yet fml

    if (selectedData.data) {
      const seen = new Set();
      for (const { card_ident: cardId } of selectedData.data) {
        if (seen.has(cardId)) continue;
        seen.add(cardId);
        markCardAsLearned(cardId);
      }
    }
  }
};

const markCardAsLearned = (id) => {
  const button = document.querySelector(`button[data-id='${id}']`);
  button?.setAttribute("data-learned", "");
};

const renderTable = (supabase, arr) => {
  const table = document.querySelector("table#document");
  if (!table) return;

  table.innerHTML = `
  <thead>
  <tr>
  <th>En</th>
  <th></th>
  <th>JP</th>
  </tr>
  </thead>
  
  <tbody>
  ${arr
    .map(
      (row, id) => `
    <tr data-id="${id}">
      <td data-lang="en">${row.en}</td>
      <td>
        <button class="learn" data-id="${id}" title="Learn"></button>
        <button class="play" data-id="${id}" title="Play">▶️</button>
      </td>
      <td data-lang="ja">${row.ja}</td>
    </tr>`
    )
    .join("\n")}
  </tbody>
  `;

  const learnHandler = (e) => {
    const id = e.target.dataset.id;
    learnRow(supabase, id);
  };

  table.querySelectorAll("button.learn").forEach((button) => {
    button.addEventListener("click", learnHandler);
  });

  const playHandler = (e) => {
    synth.cancel();

    const id = Number(e.target.dataset.id);
    const row = sentences?.[id];

    if (!row) return;

    // Say Japanese first, slowly
    speakJapanese(row.ja, 0.5);

    // Then English, normal speed
    speakEnglish(row.en);

    // Say Japanese again, normal speed
    speakJapanese(row.ja);
  };

  table.querySelectorAll("button.play").forEach((button) => {
    button.addEventListener("click", playHandler);
  });
};

const learnRow = async (supabase, id) => {
  let successes = 0;
  {
    const base = {
      document_ident: DOC_NAME,
      card_ident: `${id}`,
      result: {
        v: 0,
        type: "learn",
      },
    };
    const { data, error } = await supabase
      .from("reviews")
      .insert([
        { ...base, direction_ident: "en-ja" },
        { ...base, direction_ident: "ja-en" },
      ])
      .select();
    successes += !!data;
  }

  const updateBase = {
    p_document_ident: DOC_NAME,
    p_card_ident: `${id}`,
    p_is_correct: 0, // only used if this card is already known
  };
  const models = await Promise.all(
    ["en-ja", "ja-en"].map((direction) =>
      supabase.rpc("update_leiter_model", {
        ...updateBase,
        p_direction_ident: direction,
      })
    )
  );
  successes += !!models[0].data;
  successes += !!models[1].data;

  if (successes === 3) markCardAsLearned(id);
};

const speakJapanese = (text, rate = 1) => {
  const cleanJa = cleanJapanese(text);
  const ja = new SpeechSynthesisUtterance(cleanJa);
  if (japaneseVoice) ja.voice = japaneseVoice;
  ja.rate = rate;
  synth.speak(ja);
};

const speakEnglish = (text) => {
  const en = new SpeechSynthesisUtterance(text);
  if (englishVoice) en.voice = englishVoice;
  synth.speak(en);
};

/**
 * Replace spaces and the bar for more natural sound.
 */
const cleanJapanese = (raw) =>
  raw.replaceAll(/\s/g, "").replaceAll(/[―]+/gu, "\n");

const randElement = (arr) => arr[Math.floor(Math.random() * arr.length)];
