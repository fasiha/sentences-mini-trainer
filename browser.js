import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const DOC_NAME = "gloss-1k.json";

// Speech synthesis voices
let englishVoice = null;
let japaneseVoice = null;
const synth = window.speechSynthesis;

// Array of English/Japanese sentence pairs
let sentences = null;

document.addEventListener("DOMContentLoaded", () => {
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
});

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

    // Replace spaces and the bar for more natural sound.
    const cleanJa = row.ja.replaceAll(/\s/g, "").replaceAll(/[―]+/gu, "\n");

    // Say Japanese first, slowly
    const ja = new SpeechSynthesisUtterance(cleanJa);
    if (japaneseVoice) ja.voice = japaneseVoice;
    ja.rate = 0.5;
    synth.speak(ja);

    // Then English, normal speed
    const en = new SpeechSynthesisUtterance(row.en);
    if (englishVoice) en.voice = englishVoice;
    synth.speak(en);

    // Say Japanese again, normal speed
    const ja2 = new SpeechSynthesisUtterance(cleanJa);
    if (japaneseVoice) ja2.voice = japaneseVoice;
    synth.speak(ja2);
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
    console.log("quiz", data, error);
    successes += !!data;
  }

  const updateBase = {
    p_document_ident: DOC_NAME,
    p_card_ident: `${id}`,
    is_correct: true,
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
