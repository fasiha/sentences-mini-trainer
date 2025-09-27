import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const DOC_NAME = "gloss-1k.json";

document.addEventListener("DOMContentLoaded", () => {
  const supabase = createClient(
    "https://jjmuoksvuqkmoelmkkzt.supabase.co",
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpqbXVva3N2dXFrbW9lbG1ra3p0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTg5NDQyMTIsImV4cCI6MjA3NDUyMDIxMn0.wYkxPxckAlX1OzImJdUjvGoZ7S6NO62xE2bzMRTMUxw"
  );

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

      console.log("result", { data, error });

      if (!error) {
        hideSignIn();
        loadTable(supabase);
      }
    });

  document
    .querySelector("button#select")
    ?.addEventListener("click", async () => {
      const { data, error } = await supabase.from("reviews").select();
      console.log("reviews", { data, error });
    });

  document
    .querySelector("button#test-quiz")
    ?.addEventListener("click", async () => {
      const { data, error } = await supabase
        .from("reviews")
        .insert({
          document_ident: "testing",
          card_ident: "test 1",
          result: {
            correct: Math.random() < 0.75,
            time: Math.floor(Math.random() * 1000),
            v: 0,
          },
        })
        .select();

      console.log("insert review", { data, error });
    });
});

const hideSignIn = () => {
  document.querySelector("form#signin")?.classList.add("signed-in");
};

const loadTable = async (supabase) => {
  const { data, error } = await supabase.storage
    .from("documents")
    .download(DOC_NAME);
  if (data) {
    renderTable(supabase, JSON.parse(await data.text()));

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
      <td><button class="learn" data-id="${id}"></button></td>
      <td data-lang="ja">${row.ja}</td>
    </tr>`
    )
    .join("\n")}
  </tbody>
  `;

  table.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", (e) => {
      const id = e.target.dataset.id;
      learnRow(supabase, id);
    });
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

  {
    const intervalMs = 15 * 60e3; // 15 minutes
    const dueMs = Date.now() + intervalMs;
    const base = {
      document_ident: DOC_NAME,
      card_ident: `${id}`,
      model: { v: 0, type: "leitner", intervalMs, dueMs },
    };
    const { data, error } = await supabase
      .from("memory")
      .insert([
        { ...base, direction_ident: "en-ja" },
        { ...base, direction_ident: "ja-en" },
      ])
      .select();
    console.log("mem model", data, error);
    successes += !!data;
  }

  if (successes === 2) markCardAsLearned(id);
};
